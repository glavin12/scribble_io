from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class RoomStatus(str, Enum):
    """
    Lifecycle states for a room.

    Transitions (see implementation_plan.md for the full diagram):
        waiting    → ready        (second player joins)
        ready      → in_progress  (game start – future)
        ready      → waiting      (non-creator leaves)
        in_progress→ paused       (creator disconnects)
        in_progress→ round_end    (round ends – future)
        paused     → in_progress  (creator reconnects within grace period)
        paused     → finished     (grace period expires)
        round_end  → in_progress  (next round – future)
        *          → finished     (manual close / all players gone)
    """

    WAITING = "waiting"
    READY = "ready"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    ROUND_END = "round_end"
    FINISHED = "finished"


@dataclass
class Room:
    """
    In-memory room model.

    All timestamps are UTC.  ``timer_end`` is the wall-clock time at which the
    current game timer will expire; ``None`` when no timer is running.
    ``timer_duration`` is the configured length of that timer in seconds.
    """

    room_id: str
    creator_id: str                          # username of the room creator
    players: list[str] = field(default_factory=list)   # usernames; max 2
    status: RoomStatus = RoomStatus.WAITING
    current_drawer_id: str | None = None
    current_word: str | None = None
    scores: dict[str, int] = field(default_factory=dict)
    round_number: int = 0
    timer_end: datetime | None = None        # UTC wall-clock for current timer
    timer_duration: int | None = None        # seconds
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict:
        """
        Serialise the room to a plain dict suitable for JSON broadcast.
        Excludes ``current_word`` so non-drawers cannot see it via room events;
        expose it explicitly only to the drawer.
        """
        return {
            "room_id": self.room_id,
            "creator_id": self.creator_id,
            "players": self.players,
            "status": self.status.value,
            "current_drawer_id": self.current_drawer_id,
            "scores": self.scores,
            "round_number": self.round_number,
            "timer_end": self.timer_end.isoformat() if self.timer_end else None,
            "timer_duration": self.timer_duration,
            "created_at": self.created_at.isoformat(),
        }
