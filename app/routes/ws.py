from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.config import settings
from app.core.connection_manager import manager
from app.core.security import decode_token
from app.game.game_room import game_manager
from app.game.state import DRAW_TIME, GAME_EVENTS, IN_START_GAME, ROUNDS, GameState
from app.models.room import RoomStatus
from app.services.disconnect_timer_service import disconnect_timer_service
from app.services.room_manager import (
    AlreadyInRoom,
    InvalidRoomStatus,
    NotInRoom,
    RoomError,
    RoomFull,
    RoomNotFound,
    room_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSockets"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok(event: str, **data) -> dict:
    return {"event": event, "data": data}


def _err(code: str, message: str) -> dict:
    return {"event": "error", "data": {"code": code, "message": message}}


async def _send_err(connection_id: str, code: str, message: str) -> None:
    await manager.send(connection_id, _err(code, message))


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------


@router.websocket("/")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(None),
    nickname: str = Query(None),
):
    """
    Single WS connection point.  Room association happens via events after connect:

        → {"event": "create_room"}
        → {"event": "join_room",   "data": {"room_id": "ABCD12"}}
        → {"event": "rejoin_room", "data": {"room_id": "ABCD12"}}

    Auth: either a JWT access token OR a guest nickname.
        ws://host/ws/?token=<access_token>   (logged-in user)
        ws://host/ws/?nickname=<name>        (guest)
    """
    # --- Auth: logged-in or guest ---
    is_guest = False
    user_id: str | None = None

    if token:
        payload = decode_token(token)
        if payload and payload.get("type") != "refresh":
            user_id = payload.get("username")

    if not user_id and nickname:
        # ponytail: strip and cap length, no further validation needed
        user_id = nickname.strip()[:20] or None
        is_guest = True

    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # --- Connect ---
    connection_id = await manager.connect(websocket, user_id)
    logger.info("User '%s' connected (conn=%s, guest=%s).", user_id, connection_id, is_guest)

    # Tell the client who they are
    await manager.send(connection_id, _ok("connected", user_id=user_id, is_guest=is_guest))

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send_err(connection_id, "INVALID_JSON", "Message must be valid JSON.")
                continue

            event = msg.get("event")
            data: dict = msg.get("data", {})

            if event == "create_room":
                await handle_create_room(connection_id, user_id)
            elif event == "join_room":
                room_id = data.get("room_id", "").strip().upper()
                await handle_join_room(connection_id, user_id, room_id)
            elif event == "rejoin_room":
                room_id = data.get("room_id", "").strip().upper()
                await handle_rejoin_room(connection_id, user_id, room_id)
            elif event == "leave_room":
                await handle_leave_room(connection_id, user_id)
            elif event == IN_START_GAME:
                await handle_start_game(connection_id, user_id, data)
            elif event in GAME_EVENTS:
                await handle_game_event(connection_id, user_id, event, data)
            else:
                await _send_err(
                    connection_id,
                    "UNKNOWN_EVENT",
                    f"Unknown event '{event}'.",
                )

    except WebSocketDisconnect:
        await handle_disconnect(connection_id, user_id)


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------


async def handle_create_room(connection_id: str, user_id: str) -> None:
    """Handle the ``create_room`` event."""
    try:
        room = await room_manager.create_room(user_id)
    except AlreadyInRoom as exc:
        await _send_err(connection_id, exc.code, str(exc))
        return

    manager.bind_to_room(connection_id, room.room_id)
    await manager.send(
        connection_id,
        _ok("room_created", room=room.to_dict()),
    )
    logger.info("User '%s' created room '%s'.", user_id, room.room_id)


async def handle_join_room(
    connection_id: str, user_id: str, room_id: str
) -> None:
    """Handle the ``join_room`` event."""
    if not room_id:
        await _send_err(connection_id, "MISSING_ROOM_ID", "data.room_id is required.")
        return

    try:
        room = await room_manager.join_room(room_id, user_id)
    except RoomNotFound as exc:
        await _send_err(connection_id, exc.code, str(exc))
        return
    except (AlreadyInRoom, RoomFull, InvalidRoomStatus) as exc:
        await _send_err(connection_id, exc.code, str(exc))
        return

    manager.bind_to_room(connection_id, room_id)

    # Tell the joining player their current room state
    await manager.send(connection_id, _ok("room_joined", room=room.to_dict()))

    # Broadcast to everyone already in the room (including the new player)
    if room.status == RoomStatus.READY:
        await manager.broadcast_to_room(
            room_id,
            _ok("room_ready", room=room.to_dict()),
        )
    else:
        await manager.broadcast_to_room(
            room_id,
            _ok("player_joined", user_id=user_id, room=room.to_dict()),
            exclude_connection_id=connection_id,
        )

    logger.info("User '%s' joined room '%s' (status=%s).", user_id, room_id, room.status.value)


async def handle_rejoin_room(
    connection_id: str, user_id: str, room_id: str
) -> None:
    """
    Handle a reconnect attempt for a previously-connected user.

    Scenario: the creator's WebSocket dropped; they have a fresh connection
    and send ``rejoin_room`` with the same room_id.
    """
    if not room_id:
        await _send_err(connection_id, "MISSING_ROOM_ID", "data.room_id is required.")
        return

    # Confirm the room still exists
    room = await room_manager.get_room(room_id)
    if room is None:
        await _send_err(
            connection_id,
            "ROOM_NOT_FOUND",
            "Room no longer exists. Return to lobby.",
        )
        return

    # Confirm this user actually belongs to this room
    if user_id not in room.players:
        await _send_err(
            connection_id,
            "NOT_IN_ROOM",
            f"You are not a member of room '{room_id}'.",
        )
        return

    # Only the creator goes through the grace-period/rejoin path.
    # The non-creator should use join_room (the room stays open for them).
    if user_id != room.creator_id:
        await _send_err(
            connection_id,
            "USE_JOIN_ROOM",
            "Non-creator reconnects should use join_room.",
        )
        return

    # Cancel the pending grace-period timer
    cancelled = disconnect_timer_service.cancel_timer(room_id)
    if not cancelled:
        # Timer already expired — room should have been deleted above; if we
        # somehow reach here anyway, reject cleanly.
        await _send_err(
            connection_id,
            "ROOM_NOT_FOUND",
            "Grace period has already expired. Return to lobby.",
        )
        return

    # Rebind the new connection to the user and room
    manager.rebind_connection(user_id, connection_id)
    manager.bind_to_room(connection_id, room_id)

    # Resume the room
    try:
        room = await room_manager.resume_room(room_id)
    except InvalidRoomStatus as exc:
        await _send_err(connection_id, exc.code, str(exc))
        return

    # Confirm to the rejoining creator
    await manager.send(connection_id, _ok("rejoined", room=room.to_dict()))

    # Notify the other player
    await manager.broadcast_to_room(
        room_id,
        _ok("opponent_reconnected", room=room.to_dict()),
        exclude_connection_id=connection_id,
    )

    logger.info(
        "Creator '%s' rejoined room '%s' (timer cancelled, status=%s).",
        user_id,
        room_id,
        room.status.value,
    )


# ---------------------------------------------------------------------------
# Game event handlers
# ---------------------------------------------------------------------------


async def handle_leave_room(connection_id: str, user_id: str) -> None:
    """Handle explicit ``leave_room`` — user clicked Leave Room."""
    room_id = manager.get_room_id_for_connection(connection_id)
    if not room_id:
        return  # ponytail: nothing to leave, no error needed

    room = await room_manager.get_room(room_id)
    if room is None:
        manager.unbind_from_room(connection_id)
        return

    try:
        remaining = await room_manager.leave_room(room_id, user_id)
    except (RoomNotFound, NotInRoom):
        manager.unbind_from_room(connection_id)
        return

    manager.unbind_from_room(connection_id)

    if remaining is None:
        logger.info("Room '%s' deleted — all players left.", room_id)
        return

    await manager.broadcast_to_room(
        room_id,
        _ok("player_left", user_id=user_id, room=remaining.to_dict()),
    )
    logger.info("User '%s' left room '%s' via leave_room.", user_id, room_id)


async def handle_start_game(connection_id: str, user_id: str, data: dict | None = None) -> None:
    """Handle ``start_game`` — creator kicks off the game once room is READY."""
    data = data or {}
    room_id = manager.get_room_id_for_connection(connection_id)
    if not room_id:
        await _send_err(connection_id, "NOT_IN_ROOM", "Join a room first.")
        return

    room = await room_manager.get_room(room_id)
    if room is None:
        await _send_err(connection_id, "ROOM_NOT_FOUND", "Room not found.")
        return

    if user_id != room.creator_id:
        await _send_err(connection_id, "NOT_CREATOR", "Only the room creator can start the game.")
        return

    if game_manager.get_game(room_id) is not None:
        await _send_err(connection_id, "ALREADY_STARTED", "Game already in progress.")
        return

    try:
        await room_manager.start_room(room_id)
    except InvalidRoomStatus as exc:
        await _send_err(connection_id, exc.code, str(exc))
        return

    # ponytail: clamp & validate here, GameRoom just uses the values
    rounds = data.get("rounds", ROUNDS)
    if rounds not in (3, 5, 7):
        rounds = ROUNDS
    draw_time = data.get("draw_time", DRAW_TIME)
    try:
        draw_time = int(draw_time)
    except (TypeError, ValueError):
        draw_time = DRAW_TIME
    draw_time = max(10, min(600, draw_time))  # 10s–10min

    game = game_manager.create_game(room_id, list(room.players), rounds=rounds, draw_time=draw_time)
    await game.start_game()
    logger.info("Game started — room='%s' by '%s' rounds=%d draw_time=%ds.", room_id, user_id, rounds, draw_time)


async def handle_game_event(
    connection_id: str, user_id: str, event: str, data: dict
) -> None:
    """Route any in-game event to the active GameRoom."""
    room_id = manager.get_room_id_for_connection(connection_id)
    if not room_id:
        await _send_err(connection_id, "NOT_IN_ROOM", "You are not in a room.")
        return

    game = game_manager.get_game(room_id)
    if game is None:
        await _send_err(connection_id, "GAME_NOT_ACTIVE", "No active game in this room.")
        return

    await game.handle_event(user_id, event, data)

    if game.state == GameState.GAME_OVER:
        game_manager.remove_game(room_id)


# ---------------------------------------------------------------------------
# Disconnect logic
# ---------------------------------------------------------------------------


async def handle_disconnect(connection_id: str, user_id: str) -> None:
    """
    Called on WebSocketDisconnect.

    Creator disconnect   → pause room, start grace-period timer.
    Non-creator disconnect → remove from room, broadcast player_left.
    """
    logger.info("User '%s' disconnected (conn=%s).", user_id, connection_id)

    room_id = manager.get_room_id_for_connection(connection_id)
    manager.disconnect(connection_id)

    if not room_id:
        # Connection was never in a room — nothing more to do
        return

    room = await room_manager.get_room(room_id)
    if room is None:
        return

    # Notify active game before room-level teardown
    game = game_manager.get_game(room_id)
    if game:
        await game.handle_player_leave(user_id)
        if game.state == GameState.GAME_OVER:
            game_manager.remove_game(room_id)

    if user_id == room.creator_id:
        await _handle_creator_disconnect(user_id, room_id)
    else:
        await _handle_non_creator_disconnect(user_id, room_id)


async def _handle_creator_disconnect(user_id: str, room_id: str) -> None:
    """Pause the room and start a grace-period timer for the creator."""
    try:
        room = await room_manager.pause_room(room_id)
    except (RoomNotFound, InvalidRoomStatus) as exc:
        logger.warning("Could not pause room '%s': %s", room_id, exc)
        return

    grace = settings.ROOM_GRACE_PERIOD_SECONDS

    # Notify remaining players
    await manager.broadcast_to_room(
        room_id,
        _ok(
            "opponent_reconnecting",
            user_id=user_id,
            grace_period=grace,
            room=room.to_dict(),
        ),
    )

    # Start the grace-period timer; the callback fires if the timer is NOT cancelled
    disconnect_timer_service.start_timer(
        room_id=room_id,
        grace_seconds=grace,
        callback=_grace_period_expired,
    )

    logger.info(
        "Creator '%s' disconnected from room '%s'. Grace period: %ds.",
        user_id,
        room_id,
        grace,
    )


async def _handle_non_creator_disconnect(user_id: str, room_id: str) -> None:
    """Remove the non-creator from the room; room stays open."""
    try:
        room = await room_manager.leave_room(room_id, user_id)
    except (RoomNotFound, NotInRoom, RoomError) as exc:
        logger.warning("leave_room failed for '%s' / '%s': %s", user_id, room_id, exc)
        return

    if room is None:
        # Room became empty and was deleted
        logger.info("Room '%s' deleted — all players left.", room_id)
        return

    await manager.broadcast_to_room(
        room_id,
        _ok("player_left", user_id=user_id, room=room.to_dict()),
    )

    logger.info("Non-creator '%s' left room '%s'.", user_id, room_id)


# ---------------------------------------------------------------------------
# Grace-period expiry callback (invoked by DisconnectTimerService)
# ---------------------------------------------------------------------------


async def _grace_period_expired(room_id: str) -> None:
    """
    Called when the creator's grace period expires without a reconnect.

    Cleans up the room and notifies remaining players.
    """
    logger.info("Grace period expired for room '%s'. Closing room.", room_id)

    room = await room_manager.get_room(room_id)
    if room is None:
        return  # Already gone (e.g. last player also left)

    # Broadcast before deleting so we still have the room_to_conns mapping
    await manager.broadcast_to_room(
        room_id,
        _ok("room_closed", reason="creator_left", room_id=room_id),
    )

    game_manager.remove_game(room_id)  # no-op if no game was active
    await room_manager.delete_room(room_id)
    logger.info("Room '%s' deleted after grace period expiry.", room_id)
