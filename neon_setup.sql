-- ============================================================
-- Scribble.io — Neon PostgreSQL Setup Script
-- ============================================================
-- Run this in the Neon SQL Editor to create your database schema.
-- This matches the SQLAlchemy models in app/models/user.py
-- ============================================================

-- 1. Enable UUID generation (required for uuid_generate_v4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 2. Users Table
--    Source: app/models/user.py → User(Base)
--    Used by: /auth/register, /auth/login, /auth/refresh
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR     NOT NULL,
    email       VARCHAR     NOT NULL,
    hashed_password VARCHAR NOT NULL
);

-- Unique indexes (matching SQLAlchemy: unique=True, index=True)
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email    ON users (email);

-- ============================================================
-- DONE!
-- ============================================================
-- That's it. Your app only has ONE database table right now.
--
-- The Room/Game data (rooms, scores, game state, timers) is
-- all managed IN-MEMORY via Python dataclasses and dicts:
--   • app/models/room.py      → Room dataclass (not a DB model)
--   • app/services/room_manager.py → in-memory dict of rooms
--   • app/game/game_room.py   → in-memory game state
--
-- If you want to persist rooms/games to the DB later, you'd
-- add new SQLAlchemy models + corresponding tables here.
-- ============================================================
