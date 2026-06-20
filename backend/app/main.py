import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import APP_DATA_PATH, create_db_tables, get_database_location
from app.kts_watcher import kts_auto_sync_service
from app.routes import auto_sync, matches, player_profiles, players, public, rounds, settings, tournaments
from app.schemas import HealthCheck

app = FastAPI(title="Yu-Gi-Oh Tournament Manager API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_origin_regex=r"^https?://localhost(?::\d+)?$|^https?://127\.0\.0\.1(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(tournaments.router)
app.include_router(players.router)
app.include_router(rounds.router)
app.include_router(matches.router)
app.include_router(player_profiles.router)
app.include_router(public.router)
app.include_router(auto_sync.router)
app.include_router(settings.router)

logger = logging.getLogger(__name__)


@app.on_event("startup")
def on_startup() -> None:
    if APP_DATA_PATH:
        logger.info("App data directory: %s", APP_DATA_PATH)
    logger.info("Database location: %s", get_database_location())
    create_db_tables()


@app.on_event("shutdown")
def on_shutdown() -> None:
    kts_auto_sync_service.stop()


@app.get("/health", response_model=HealthCheck)
def health_check() -> HealthCheck:
    return HealthCheck(status="ok")
