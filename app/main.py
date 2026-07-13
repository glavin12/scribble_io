from fastapi import FastAPI
from app.db.database import engine, Base
from app.routes import auth, ws
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        # For development only: auto-create tables. Use Alembic in production!
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(title="Scribble.io Backend", lifespan=lifespan)

# Include Routers
app.include_router(auth.router)
app.include_router(ws.router)
