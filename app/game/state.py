from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class GameState(str, Enum):
    """
    Lifecycle states owned exclusively by GameRoom.

    Transitions:
        WAITING   → CHOOSING    (start_round picks a drawer)
        CHOOSING  → DRAWING     (drawer sends choose_word)
        CHOOSING  → DRAWING     (choice_deadline expires → server auto-picks)
        DRAWING   → ROUND_END   (timeout | all guessed | drawer_left | skipped)
        ROUND_END → CHOOSING    (next round)
        ROUND_END → GAME_OVER   (all rounds done)
    """

    WAITING   = "waiting"    # Lobby — game not yet started
    CHOOSING  = "choosing"   # Drawer is picking a word from candidates
    DRAWING   = "drawing"    # Active drawing round
    ROUND_END = "round_end"  # Brief pause between rounds
    GAME_OVER = "game_over"  # All rounds finished


# ---------------------------------------------------------------------------
# Game-wide constants — one place to change, no class overhead needed
# ---------------------------------------------------------------------------

ROUNDS: int = 3
DRAW_TIME: int = 80          # seconds per drawing round
CHOOSE_TIME: int = 15        # seconds the drawer has to pick a word
TICK_INTERVAL: int = 5       # how often to push timer_tick to clients
WORD_CHOICES: int = 3        # how many words the drawer sees to choose from
MIN_PLAYERS: int = 2

# Scoring
GUESSER_BASE: int = 100
GUESSER_TIME_BONUS: int = 100   # added linearly for fast guesses
DRAWER_PER_CORRECT: int = 50    # per player who guesses correctly


# ---------------------------------------------------------------------------
# Incoming event names  (client → server)
# ---------------------------------------------------------------------------

IN_START_GAME   = "start_game"
IN_CHOOSE_WORD  = "choose_word"   # drawer picks from candidates
IN_DRAW         = "draw"
IN_CLEAR        = "clear_canvas"
IN_GUESS        = "guess"
IN_SKIP         = "skip"          # drawer skips (auto-picks next word? or ends round)

# Events ws.py routes directly into GameRoom.handle_event()
# ponytail: frozenset because membership tests are the only operation
GAME_EVENTS: frozenset[str] = frozenset(
    {IN_CHOOSE_WORD, IN_DRAW, IN_CLEAR, IN_GUESS, IN_SKIP}
)

# ---------------------------------------------------------------------------
# Outgoing event names  (server → client)
# ---------------------------------------------------------------------------

OUT_GAME_STARTED   = "game_started"
OUT_ROUND_STARTED  = "round_started"    # new round began, includes drawer + draw_time
OUT_WORD_CHOICES   = "word_choices"     # sent ONLY to drawer: list of candidate words
OUT_DRAWING_STARTED = "drawing_started" # broadcast when drawer has chosen; drawing begins
OUT_DRAW           = "draw"             # relayed stroke data
OUT_CLEAR          = "canvas_cleared"
OUT_GUESSED        = "player_guessed"
OUT_ROUND_ENDED    = "round_ended"
OUT_GAME_OVER      = "game_over"
OUT_TIMER_TICK     = "timer_tick"
OUT_ERROR          = "error"
