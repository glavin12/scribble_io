from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

# Type alias for the async callback invoked when a timer fires.
# Signature: async def callback(room_id: str) -> None
GracePeriodCallback = Callable[[str], Awaitable[None]]


class DisconnectTimerService:
    """
    Manages per-room grace-period timers for creator reconnects.

    Each timer is an ``asyncio.Task`` wrapping a ``asyncio.sleep`` followed
    by a caller-supplied callback.  The task can be cancelled cleanly if the
    creator reconnects before the sleep completes.

    Usage::

        timer_service = DisconnectTimerService()

        async def on_expire(room_id: str) -> None:
            await room_manager.delete_room(room_id)
            await connection_manager.broadcast_to_room(room_id, {...})

        timer_service.start_timer("ABCD12", grace_seconds=15, callback=on_expire)

        # … later, if creator reconnects …
        timer_service.cancel_timer("ABCD12")
    """

    def __init__(self) -> None:
        self._timers: dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def start_timer(
        self,
        room_id: str,
        grace_seconds: int,
        callback: GracePeriodCallback,
    ) -> None:
        """
        Start a grace-period timer for *room_id*.

        If a timer is already running for this room it is cancelled first
        (idempotent restart behaviour — useful if the creator rapidly
        disconnects/reconnects multiple times).
        """
        self.cancel_timer(room_id)  # cancel any stale timer first
        task = asyncio.create_task(
            self._run(room_id, grace_seconds, callback),
            name=f"grace-period-{room_id}",
        )
        self._timers[room_id] = task

    def cancel_timer(self, room_id: str) -> bool:
        """
        Cancel the grace-period timer for *room_id*.

        Returns ``True`` if a timer was running and was cancelled,
        ``False`` if there was nothing to cancel.
        """
        task = self._timers.pop(room_id, None)
        if task and not task.done():
            task.cancel()
            logger.debug("Grace-period timer cancelled for room '%s'.", room_id)
            return True
        return False

    def has_active_timer(self, room_id: str) -> bool:
        """Return ``True`` if a non-done timer task exists for *room_id*."""
        task = self._timers.get(room_id)
        return task is not None and not task.done()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _run(
        self,
        room_id: str,
        grace_seconds: int,
        callback: GracePeriodCallback,
    ) -> None:
        """Sleep then invoke *callback*.  Handles CancelledError silently."""
        try:
            await asyncio.sleep(grace_seconds)
            logger.info(
                "Grace period expired for room '%s' — triggering cleanup.", room_id
            )
            await callback(room_id)
        except asyncio.CancelledError:
            # Timer was cancelled (creator reconnected in time) — nothing to do.
            pass
        except Exception:
            logger.exception(
                "Unhandled error in grace-period callback for room '%s'.", room_id
            )
        finally:
            # Remove our own reference so has_active_timer returns False
            self._timers.pop(room_id, None)


# Module-level singleton shared across the application
disconnect_timer_service = DisconnectTimerService()
