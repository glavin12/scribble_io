from __future__ import annotations

import random
import string
from datetime import datetime, timezone

from app.core.config import settings
from app.models.room import Room, RoomStatus

# ---------------------------------------------------------------------------
# Typed exceptions — catch these by type in WS handlers so they map cleanly
# to error codes without string-matching.
# ---------------------------------------------------------------------------


class RoomError(Exception):
    """Base class for all room-layer errors."""

    code: str = "ROOM_ERROR"


class RoomNotFound(RoomError):
    code = "ROOM_NOT_FOUND"


class RoomFull(RoomError):
    code = "ROOM_FULL"


class AlreadyInRoom(RoomError):
    code = "ALREADY_IN_ROOM"


class NotInRoom(RoomError):
    code = "NOT_IN_ROOM"


class InvalidRoomStatus(RoomError):
    code = "INVALID_ROOM_STATUS"


# ---------------------------------------------------------------------------
# Room ID generation
# ---------------------------------------------------------------------------

# No vowels (avoids accidental words), no ambiguous chars (0/O, 1/I/l)
_ROOM_ID_CHARS = "BCDFGHJKLMNPQRSTVWXYZ23456789"


def _generate_room_id(length: int) -> str:
    return "".join(random.choices(_ROOM_ID_CHARS, k=length))


# ---------------------------------------------------------------------------
# RoomManager
# ---------------------------------------------------------------------------


class RoomManager:
    """
    In-memory store for game rooms.

    All public methods are ``async`` even though the current implementation
    performs only synchronous dict operations.  This keeps the call-site
    identical when swapping to a Redis backend later — callers just ``await``
    every method and never need to change.

    Internal state
    --------------
    _rooms         : room_id  → Room
    _user_to_room  : user_id  → room_id   (one room per user enforced)
    """

    MAX_PLAYERS: int = 2

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._user_to_room: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def create_room(self, creator_id: str) -> Room:
        """
        Create a new room owned by *creator_id*.

        Raises
        ------
        AlreadyInRoom  if the user is already in a room.
        """
        if creator_id in self._user_to_room:
            existing_room_id = self._user_to_room[creator_id]
            if existing_room_id in self._rooms:
                raise AlreadyInRoom(
                    f"User '{creator_id}' is already in room '{existing_room_id}'."
                )
            # ponytail: stale entry — room was deleted, clean it up silently
            del self._user_to_room[creator_id]

        room_id = self._unique_room_id()
        room = Room(
            room_id=room_id,
            creator_id=creator_id,
            players=[creator_id],
            scores={creator_id: 0},
        )
        self._rooms[room_id] = room
        self._user_to_room[creator_id] = room_id
        return room

    async def join_room(self, room_id: str, user_id: str) -> Room:
        """
        Add *user_id* to an existing room.

        Raises
        ------
        RoomNotFound   if the room does not exist.
        AlreadyInRoom  if the user is already in *any* room.
        RoomFull       if the room already has MAX_PLAYERS players.
        InvalidRoomStatus if the room is not in a joinable state.
        """
        room = await self._get_or_raise(room_id)

        if user_id in self._user_to_room:
            existing = self._user_to_room[user_id]
            if existing in self._rooms:
                if existing == room_id:
                    raise AlreadyInRoom(
                        f"User '{user_id}' is already in room '{room_id}'."
                    )
                raise AlreadyInRoom(
                    f"User '{user_id}' is already in a different room '{existing}'."
                )
            # ponytail: stale entry — room was deleted, clean it up silently
            del self._user_to_room[user_id]

        if len(room.players) >= self.MAX_PLAYERS:
            raise RoomFull(f"Room '{room_id}' is full.")

        joinable = {RoomStatus.WAITING, RoomStatus.PAUSED}
        if room.status not in joinable:
            raise InvalidRoomStatus(
                f"Room '{room_id}' is in status '{room.status.value}' and cannot be joined."
            )

        room.players.append(user_id)
        room.scores[user_id] = 0
        self._user_to_room[user_id] = room_id

        # Transition: waiting → ready once both seats are filled
        if len(room.players) == self.MAX_PLAYERS and room.status == RoomStatus.WAITING:
            room.status = RoomStatus.READY

        return room

    async def leave_room(self, room_id: str, user_id: str) -> Room | None:
        """
        Remove *user_id* from the room.

        Returns the updated Room (still alive) or ``None`` if the room was
        deleted because it became empty.

        Raises
        ------
        RoomNotFound  if the room does not exist.
        NotInRoom     if the user is not in the room.
        """
        room = await self._get_or_raise(room_id)

        if user_id not in room.players:
            raise NotInRoom(f"User '{user_id}' is not in room '{room_id}'.")

        room.players.remove(user_id)
        self._user_to_room.pop(user_id, None)

        if not room.players:
            # Room is now empty — clean it up
            del self._rooms[room_id]
            return None

        # Demote status if we're back to one player
        if len(room.players) == 1 and room.status == RoomStatus.READY:
            room.status = RoomStatus.WAITING

        return room

    async def get_room(self, room_id: str) -> Room | None:
        """Return the Room or ``None`` if it does not exist."""
        return self._rooms.get(room_id)

    async def delete_room(self, room_id: str) -> None:
        """
        Unconditionally delete the room and clean up all user→room mappings.
        Safe to call even if the room does not exist.
        """
        room = self._rooms.pop(room_id, None)
        if room:
            for player in room.players:
                self._user_to_room.pop(player, None)

    async def pause_room(self, room_id: str) -> Room:
        """
        Transition the room to ``paused``.

        Raises
        ------
        RoomNotFound     if the room does not exist.
        InvalidRoomStatus if the room is already finished or waiting.
        """
        room = await self._get_or_raise(room_id)
        pausable = {RoomStatus.IN_PROGRESS, RoomStatus.READY, RoomStatus.WAITING}
        if room.status not in pausable:
            raise InvalidRoomStatus(
                f"Cannot pause room '{room_id}' from status '{room.status.value}'."
            )
        room.status = RoomStatus.PAUSED
        return room

    async def resume_room(self, room_id: str) -> Room:
        """
        Transition the room from ``paused`` back to its previous logical state.

        For 1-on-1 rooms: if both players are present → ``in_progress`` (or
        ``ready`` if the game has not started yet, i.e. round_number == 0).
        If only one player is present → ``waiting``.

        Raises
        ------
        RoomNotFound      if the room does not exist.
        InvalidRoomStatus if the room is not currently paused.
        """
        room = await self._get_or_raise(room_id)
        if room.status != RoomStatus.PAUSED:
            raise InvalidRoomStatus(
                f"Cannot resume room '{room_id}' from status '{room.status.value}'."
            )

        if len(room.players) == self.MAX_PLAYERS:
            room.status = (
                RoomStatus.IN_PROGRESS if room.round_number > 0 else RoomStatus.READY
            )
        else:
            room.status = RoomStatus.WAITING

        return room

    async def start_room(self, room_id: str) -> Room:
        """
        Transition the room to ``in_progress`` (game has started).

        Raises
        ------
        RoomNotFound     if the room does not exist.
        InvalidRoomStatus if the room is not in ``ready`` state.
        """
        room = await self._get_or_raise(room_id)
        if room.status != RoomStatus.READY:
            raise InvalidRoomStatus(
                f"Cannot start game in room '{room_id}' from status '{room.status.value}'."
            )
        room.status = RoomStatus.IN_PROGRESS
        return room

    async def get_room_for_user(self, user_id: str) -> Room | None:
        """Return the room the user is currently in, or ``None``."""
        room_id = self._user_to_room.get(user_id)
        if not room_id:
            return None
        return self._rooms.get(room_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_or_raise(self, room_id: str) -> Room:
        room = self._rooms.get(room_id)
        if room is None:
            raise RoomNotFound(f"Room '{room_id}' does not exist.")
        return room

    def _unique_room_id(self) -> str:
        """Generate a room ID that is not currently in use."""
        length = settings.ROOM_ID_LENGTH
        for _ in range(100):  # practically impossible to exhaust
            candidate = _generate_room_id(length)
            if candidate not in self._rooms:
                return candidate
        raise RuntimeError("Could not generate a unique room ID — pool exhausted.")


# ---------------------------------------------------------------------------
# Module-level singleton (imported by WS handlers and the timer service)
# ---------------------------------------------------------------------------

room_manager = RoomManager()
