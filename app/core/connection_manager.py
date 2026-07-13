from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages all active WebSocket connections with room and user awareness.

    Internal state
    --------------
    _conn_sockets  : connection_id → WebSocket
    _conn_to_user  : connection_id → user_id
    _conn_to_room  : connection_id → room_id      (set after room join)
    _user_to_conn  : user_id       → connection_id (latest active conn)
    _room_to_conns : room_id       → {connection_id, …}

    All lookups are O(1) via dict.  ``connection_id`` is a ``uuid4`` string
    generated at connect-time and returned to the WS handler so it can be
    stored for the lifetime of the session.
    """

    def __init__(self) -> None:
        self._conn_sockets: dict[str, WebSocket] = {}
        self._conn_to_user: dict[str, str] = {}
        self._conn_to_room: dict[str, str] = {}
        self._user_to_conn: dict[str, str] = {}
        self._room_to_conns: dict[str, set[str]] = {}

    # ------------------------------------------------------------------
    # Connect / disconnect
    # ------------------------------------------------------------------

    async def connect(self, websocket: WebSocket, user_id: str) -> str:
        """
        Accept the WebSocket and register the connection.

        Returns
        -------
        connection_id : str
            A fresh ``uuid4`` string the caller should hold for the session
            lifetime and pass to ``disconnect``.
        """
        await websocket.accept()
        connection_id = str(uuid.uuid4())
        self._conn_sockets[connection_id] = websocket
        self._conn_to_user[connection_id] = user_id
        self._user_to_conn[user_id] = connection_id
        logger.debug("User '%s' connected (conn=%s).", user_id, connection_id)
        return connection_id

    def disconnect(self, connection_id: str) -> None:
        """
        Tear down all state associated with *connection_id*.

        Does *not* remove the user→room mapping — that is the responsibility
        of the room handler (it needs to decide whether to pause/delete).
        """
        user_id = self._conn_to_user.pop(connection_id, None)
        room_id = self._conn_to_room.pop(connection_id, None)
        self._conn_sockets.pop(connection_id, None)

        # Only clear user→conn if it still points to *this* connection
        # (a rebind may have already replaced it with the new connection_id)
        if user_id and self._user_to_conn.get(user_id) == connection_id:
            self._user_to_conn.pop(user_id, None)

        if room_id:
            conns = self._room_to_conns.get(room_id)
            if conns:
                conns.discard(connection_id)
                if not conns:
                    del self._room_to_conns[room_id]

        logger.debug(
            "Connection %s disconnected (user=%s, room=%s).",
            connection_id,
            user_id,
            room_id,
        )

    # ------------------------------------------------------------------
    # Room binding
    # ------------------------------------------------------------------

    def bind_to_room(self, connection_id: str, room_id: str) -> None:
        """Associate an already-connected session with a room."""
        # Remove from old room if re-binding (shouldn't happen in normal flow
        # but safe to handle)
        old_room = self._conn_to_room.get(connection_id)
        if old_room and old_room != room_id:
            old_conns = self._room_to_conns.get(old_room)
            if old_conns:
                old_conns.discard(connection_id)
                if not old_conns:
                    del self._room_to_conns[old_room]

        self._conn_to_room[connection_id] = room_id
        self._room_to_conns.setdefault(room_id, set()).add(connection_id)

    def unbind_from_room(self, connection_id: str) -> None:
        """Remove the room association for this connection."""
        room_id = self._conn_to_room.pop(connection_id, None)
        if room_id:
            conns = self._room_to_conns.get(room_id)
            if conns:
                conns.discard(connection_id)
                if not conns:
                    del self._room_to_conns[room_id]

    # ------------------------------------------------------------------
    # Reconnect support
    # ------------------------------------------------------------------

    def rebind_connection(self, user_id: str, new_connection_id: str) -> None:
        """
        Re-associate *user_id* with a brand-new *connection_id* after a
        reconnect, and move the old room binding (if any) to the new id.

        The caller must have already called ``connect`` for the new socket
        (so ``new_connection_id`` is already registered in ``_conn_sockets``).
        The old connection should have already been cleaned up via ``disconnect``.
        """
        old_conn_id = self._user_to_conn.get(user_id)

        # Move room binding from old → new connection
        if old_conn_id:
            room_id = self._conn_to_room.pop(old_conn_id, None)
            if room_id:
                conns = self._room_to_conns.get(room_id)
                if conns:
                    conns.discard(old_conn_id)
                self._conn_to_room[new_connection_id] = room_id
                self._room_to_conns.setdefault(room_id, set()).add(new_connection_id)

        # Point user → new connection
        self._user_to_conn[user_id] = new_connection_id
        self._conn_to_user[new_connection_id] = user_id

        logger.debug(
            "Rebound user '%s': %s → %s.", user_id, old_conn_id, new_connection_id
        )

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_connection_id_for_user(self, user_id: str) -> str | None:
        return self._user_to_conn.get(user_id)

    def get_room_id_for_connection(self, connection_id: str) -> str | None:
        return self._conn_to_room.get(connection_id)

    def get_user_id_for_connection(self, connection_id: str) -> str | None:
        return self._conn_to_user.get(connection_id)

    def get_connections_in_room(self, room_id: str) -> set[str]:
        return set(self._room_to_conns.get(room_id, set()))

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    async def send(self, connection_id: str, message: dict[str, Any]) -> None:
        """Send a JSON message to a single connection. Silently drops on error."""
        ws = self._conn_sockets.get(connection_id)
        if not ws:
            return
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            logger.warning("Failed to send to connection %s.", connection_id)

    async def broadcast_to_room(
        self,
        room_id: str,
        message: dict[str, Any],
        exclude_connection_id: str | None = None,
    ) -> None:
        """
        Send *message* (as JSON) to every connection currently bound to *room_id*.

        Parameters
        ----------
        exclude_connection_id
            If set, skip this connection (e.g. don't echo back to the sender).
        """
        payload = json.dumps(message)
        connection_ids = self.get_connections_in_room(room_id)
        for conn_id in connection_ids:
            if conn_id == exclude_connection_id:
                continue
            ws = self._conn_sockets.get(conn_id)
            if not ws:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                logger.warning(
                    "broadcast_to_room: failed to send to connection %s in room %s.",
                    conn_id,
                    room_id,
                )


# Module-level singleton
manager = ConnectionManager()
