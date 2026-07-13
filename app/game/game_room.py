"""
game_room.py — server-authoritative game logic for Scribble.io.

Public surface used by ws.py:
    game_manager.create_game(room_id, players) -> GameRoom
    game_manager.get_game(room_id)             -> GameRoom | None
    game_manager.remove_game(room_id)
    game.start_game()
    game.handle_event(player_id, event, data)
    game.handle_player_leave(player_id)
    game.state                                 -> GameState

Design constraints enforced here:
- Server always picks the word, the drawer, and calculates scores.
- Clients cannot change game state via the data payload.
- Wrong guesses are silently dropped (avoids revealing correctness).
- No images stored — only stroke events are relayed.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time

from app.core.connection_manager import manager
from app.game.scoring import calculate_drawer_score, calculate_guesser_score
from app.game.state import (
    CHOOSE_TIME,
    DRAW_TIME,
    DRAWER_PER_CORRECT,
    GAME_EVENTS,
    GUESSER_BASE,
    GUESSER_TIME_BONUS,
    IN_CHOOSE_WORD,
    IN_CLEAR,
    IN_DRAW,
    IN_GUESS,
    IN_SKIP,
    MIN_PLAYERS,
    OUT_CLEAR,
    OUT_DRAW,
    OUT_DRAWING_STARTED,
    OUT_ERROR,
    OUT_GAME_OVER,
    OUT_GAME_STARTED,
    OUT_GUESSED,
    OUT_ROUND_ENDED,
    OUT_ROUND_STARTED,
    OUT_TIMER_TICK,
    OUT_WORD_CHOICES,
    ROUNDS,
    TICK_INTERVAL,
    WORD_CHOICES,
    GameState,
)
from app.game.word_bank import pick_word, pick_words

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# RoundTimer — asyncio task wrapper (ponytail: too small to deserve its own file)
# ---------------------------------------------------------------------------


class _RoundTimer:
    """
    Counts down *duration* seconds, firing on_tick every TICK_INTERVAL seconds
    and on_expire when it reaches zero.  cancel() kills it silently.

    Uses min(TICK_INTERVAL, remaining) so the timer hits *exactly* zero —
    no overshoot drift even when tick_interval doesn't divide duration evenly.
    """

    def __init__(self, duration: int, on_tick, on_expire) -> None:
        self._duration  = duration
        self._on_tick   = on_tick
        self._on_expire = on_expire
        self._task: asyncio.Task | None = None
        self._started_at: float | None  = None

    def start(self) -> None:
        self.cancel()
        self._started_at = time.monotonic()
        self._task = asyncio.create_task(self._run(), name=f"timer-{id(self)}")

    def cancel(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None
        self._started_at = None

    def elapsed(self) -> float:
        return time.monotonic() - self._started_at if self._started_at else 0.0

    async def _run(self) -> None:
        try:
            remaining = self._duration
            while remaining > 0:
                sleep_for = min(TICK_INTERVAL, remaining)
                await asyncio.sleep(sleep_for)
                remaining -= sleep_for
                await self._on_tick(max(0, remaining))
            await self._on_expire()
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("_RoundTimer error")


# ---------------------------------------------------------------------------
# GameRoom
# ---------------------------------------------------------------------------


class GameRoom:
    """
    Owns all game state for one session.  Never touches JWT, DB, or sockets
    directly — it resolves player_id → connection_id via ConnectionManager
    and sends/broadcasts through that.

    Word-choice flow (new):
        start_round()
            → state = CHOOSING
            → send word_choices to drawer only
            → start CHOOSE_TIME countdown
        _on_choose_word() OR _on_choice_deadline()
            → cancel choice timer
            → state = DRAWING
            → broadcast drawing_started
            → start DRAW_TIME countdown

    Drawer rotation:
        Deterministic round-robin from a random starting index so every player
        draws the same number of times.  Works for 2–N players unchanged.
    """

    def __init__(self, room_id: str, players: list[str]) -> None:
        self._room_id   = room_id
        self._players   = list(players)
        self._state     = GameState.WAITING
        self._scores: dict[str, int] = {p: 0 for p in self._players}
        self._round     = 0
        self._drawer_id: str | None   = None
        self._word: str | None        = None
        self._candidates: list[str]   = []   # words offered to drawer this round
        self._used_words: list[str]   = []   # avoid repeating words in same game
        self._guessed: set[str]       = set()
        self._start_idx: int          = random.randrange(len(self._players))
        self._timer: _RoundTimer | None = None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def state(self) -> GameState:
        return self._state

    @property
    def room_id(self) -> str:
        return self._room_id

    # ------------------------------------------------------------------
    # Public API (called by ws.py)
    # ------------------------------------------------------------------

    async def start_game(self) -> None:
        if self._state != GameState.WAITING:
            return
        logger.info("Game starting — room='%s' players=%s", self._room_id, self._players)
        await self._broadcast(OUT_GAME_STARTED, players=self._players, scores=self._scores)
        await self._start_round()

    async def handle_event(self, player_id: str, event: str, data: dict) -> None:
        """Single public dispatch point for all in-game events."""
        if player_id not in self._players:
            await self._err(player_id, "NOT_IN_GAME", "You are not in this game.")
            return

        dispatch = {
            IN_CHOOSE_WORD: self._on_choose_word,
            IN_DRAW:        self._on_draw,
            IN_CLEAR:       self._on_clear,
            IN_GUESS:       self._on_guess,
            IN_SKIP:        self._on_skip,
        }
        handler = dispatch.get(event)
        if handler:
            await handler(player_id, data)

    async def handle_player_leave(self, player_id: str) -> None:
        """Called by ws.py on disconnect.  Adjusts game state accordingly."""
        if player_id not in self._players:
            return
        self._players.remove(player_id)
        self._scores.pop(player_id, None)
        logger.info("Player '%s' left game in room '%s'.", player_id, self._room_id)

        if self._state in (GameState.DRAWING, GameState.CHOOSING):
            if len(self._players) < MIN_PLAYERS:
                await self.end_game("not_enough_players")
            elif player_id == self._drawer_id:
                await self._end_round("drawer_left")
            elif self._state == GameState.DRAWING:
                await self._check_all_guessed()

    # ------------------------------------------------------------------
    # Round lifecycle
    # ------------------------------------------------------------------

    async def _start_round(self) -> None:
        self._round   += 1
        self._guessed  = set()
        self._state    = GameState.CHOOSING

        # Deterministic drawer rotation — works for any player count
        idx = (self._start_idx + self._round - 1) % len(self._players)
        self._drawer_id = self._players[idx]

        # Pick WORD_CHOICES candidates; the drawer will pick one
        self._candidates = pick_words(WORD_CHOICES, exclude=self._used_words)
        self._word = None  # set after drawer chooses (or auto-pick on deadline)

        # Broadcast round metadata (no word yet — drawer still choosing)
        await self._broadcast(
            OUT_ROUND_STARTED,
            round_number=self._round,
            total_rounds=ROUNDS,
            drawer_id=self._drawer_id,
            choose_time=CHOOSE_TIME,
            scores=self._scores,
        )

        # Send candidate words only to the drawer
        await self._send(
            self._drawer_id,
            OUT_WORD_CHOICES,
            candidates=self._candidates,
            round_number=self._round,
        )

        # Start choice deadline — auto-picks first candidate if drawer is slow
        self._timer = _RoundTimer(
            duration=CHOOSE_TIME,
            on_tick=self._on_choice_tick,
            on_expire=self._on_choice_deadline,
        )
        self._timer.start()

        logger.info(
            "Round %d/%d — room='%s' drawer='%s' candidates=%s",
            self._round, ROUNDS, self._room_id, self._drawer_id, self._candidates,
        )

    async def _begin_drawing(self, word: str) -> None:
        """Transition from CHOOSING → DRAWING once a word is confirmed."""
        if self._timer:
            self._timer.cancel()

        self._word  = word
        self._state = GameState.DRAWING
        self._used_words.append(word)

        # Broadcast drawing_started (word hidden from guessers)
        await self._broadcast(
            OUT_DRAWING_STARTED,
            round_number=self._round,
            drawer_id=self._drawer_id,
            draw_time=DRAW_TIME,
            word_length=len(word),   # hint: number of letters
        )

        # Start the drawing countdown
        self._timer = _RoundTimer(
            duration=DRAW_TIME,
            on_tick=self._on_draw_tick,
            on_expire=self._on_draw_expire,
        )
        self._timer.start()

        logger.info("Drawing started — room='%s' word='%s'", self._room_id, word)

    async def _end_round(self, reason: str = "timeout") -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

        self._state = GameState.ROUND_END

        # Award drawer for each correct guesser
        if self._drawer_id and self._drawer_id in self._scores:
            self._scores[self._drawer_id] += calculate_drawer_score(
                len(self._guessed), DRAWER_PER_CORRECT
            )

        await self._broadcast(
            OUT_ROUND_ENDED,
            round_number=self._round,
            total_rounds=ROUNDS,
            word=self._word,
            scores=self._scores,
            reason=reason,
        )
        logger.info("Round %d ended — room='%s' reason=%s", self._round, self._room_id, reason)

        if self._round >= ROUNDS or len(self._players) < MIN_PLAYERS:
            await self.end_game()
        else:
            await self._start_round()

    async def end_game(self, reason: str = "completed") -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None
        self._state = GameState.GAME_OVER
        winner = max(self._scores, key=self._scores.get, default=None)
        await self._broadcast(OUT_GAME_OVER, scores=self._scores, winner=winner, reason=reason)
        logger.info("Game over — room='%s' winner='%s' scores=%s", self._room_id, winner, self._scores)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    async def _on_choose_word(self, player_id: str, data: dict) -> None:
        if self._state != GameState.CHOOSING:
            await self._err(player_id, "INVALID_STATE", "Not in word-choice phase.")
            return
        if player_id != self._drawer_id:
            await self._err(player_id, "NOT_DRAWER", "Only the drawer chooses the word.")
            return

        chosen: str = str(data.get("word", "")).strip().lower()
        if chosen not in self._candidates:
            await self._err(player_id, "INVALID_WORD", "Choose one of the offered words.")
            return

        await self._begin_drawing(chosen)

    async def _on_draw(self, player_id: str, data: dict) -> None:
        if self._state != GameState.DRAWING:
            await self._err(player_id, "INVALID_STATE", "No active drawing round.")
            return
        if player_id != self._drawer_id:
            await self._err(player_id, "NOT_DRAWER", "Only the drawer can draw.")
            return
        # Relay stroke data — server never stores the image
        await self._broadcast(OUT_DRAW, stroke=data.get("stroke"), exclude=player_id)

    async def _on_clear(self, player_id: str, data: dict) -> None:
        if self._state != GameState.DRAWING:
            return
        if player_id != self._drawer_id:
            await self._err(player_id, "NOT_DRAWER", "Only the drawer can clear.")
            return
        await self._broadcast(OUT_CLEAR, exclude=player_id)

    async def _on_guess(self, player_id: str, data: dict) -> None:
        if self._state != GameState.DRAWING:
            await self._err(player_id, "INVALID_STATE", "No active drawing round.")
            return
        if player_id == self._drawer_id:
            await self._err(player_id, "DRAWER_CANNOT_GUESS", "Drawer cannot guess.")
            return
        if player_id in self._guessed:
            await self._err(player_id, "ALREADY_GUESSED", "You already guessed correctly.")
            return

        guess = str(data.get("guess", "")).strip().lower()
        if not guess:
            return  # silently drop empty — ponytail: no need to error on blank

        if guess != (self._word or "").lower():
            return  # wrong guess: silent drop — don't confirm it's wrong

        # Correct!
        earned = calculate_guesser_score(
            elapsed=self._timer.elapsed() if self._timer else 0.0,
            total=DRAW_TIME,
            base=GUESSER_BASE,
            bonus_max=GUESSER_TIME_BONUS,
        )
        self._scores[player_id] += earned
        self._guessed.add(player_id)

        await self._broadcast(
            OUT_GUESSED,
            player_id=player_id,
            earned=earned,
            scores=self._scores,
        )
        logger.info("'%s' guessed correctly in room '%s' (+%d).", player_id, self._room_id, earned)

        await self._check_all_guessed()

    async def _on_skip(self, player_id: str, data: dict) -> None:
        if self._state != GameState.DRAWING:
            await self._err(player_id, "INVALID_STATE", "No active drawing round.")
            return
        if player_id != self._drawer_id:
            await self._err(player_id, "NOT_DRAWER", "Only the drawer can skip.")
            return
        await self._end_round("skipped")

    # ------------------------------------------------------------------
    # Timer callbacks
    # ------------------------------------------------------------------

    async def _on_choice_tick(self, remaining: int) -> None:
        # Only send to drawer — guessers don't need the choice countdown
        await self._send(self._drawer_id, OUT_TIMER_TICK, phase="choosing", remaining=remaining)

    async def _on_choice_deadline(self) -> None:
        """Drawer didn't pick in time — auto-pick the first candidate."""
        if self._state != GameState.CHOOSING:
            return
        logger.info("Choice deadline — auto-picking for '%s' in room '%s'.", self._drawer_id, self._room_id)
        await self._begin_drawing(self._candidates[0])

    async def _on_draw_tick(self, remaining: int) -> None:
        await self._broadcast(OUT_TIMER_TICK, phase="drawing", remaining=remaining)

    async def _on_draw_expire(self) -> None:
        if self._state == GameState.DRAWING:
            await self._end_round("timeout")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _check_all_guessed(self) -> None:
        non_drawers = [p for p in self._players if p != self._drawer_id]
        if non_drawers and all(p in self._guessed for p in non_drawers):
            await self._end_round("all_guessed")

    async def _send(self, player_id: str, event: str, **data) -> None:
        conn = manager.get_connection_id_for_user(player_id)
        if conn:
            await manager.send(conn, {"event": event, "data": data})

    async def _err(self, player_id: str, code: str, msg: str) -> None:
        await self._send(player_id, OUT_ERROR, code=code, message=msg)

    async def _broadcast(self, event: str, exclude: str | None = None, **data) -> None:
        excl_conn = manager.get_connection_id_for_user(exclude) if exclude else None
        await manager.broadcast_to_room(
            self._room_id,
            {"event": event, "data": data},
            exclude_connection_id=excl_conn,
        )


# ---------------------------------------------------------------------------
# GameManager — just a dict with a name
# ponytail: a class with create/get/remove on a plain dict; no base class,
#           no interface, no factory. Add Redis/pub-sub here if ever needed.
# ---------------------------------------------------------------------------


class _GameManager:
    def __init__(self) -> None:
        self._games: dict[str, GameRoom] = {}

    def create_game(self, room_id: str, players: list[str]) -> GameRoom:
        game = GameRoom(room_id, players)
        self._games[room_id] = game
        logger.info("GameRoom created — room='%s' players=%s", room_id, players)
        return game

    def get_game(self, room_id: str) -> GameRoom | None:
        return self._games.get(room_id)

    def remove_game(self, room_id: str) -> None:
        if self._games.pop(room_id, None):
            logger.info("GameRoom removed — room='%s'", room_id)


game_manager = _GameManager()
