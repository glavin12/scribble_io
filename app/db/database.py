from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.core.config import settings
import re

# Accept plain postgresql:// URLs (e.g. from Neon) — swap to asyncpg driver
# asyncpg doesn't understand 'sslmode' or 'channel_binding', strip them
_db_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
_db_url = re.sub(r"[&?]channel_binding=[^&]*", "", _db_url)
_db_url = _db_url.replace("sslmode=", "ssl=")
engine = create_async_engine(_db_url, echo=True)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()
