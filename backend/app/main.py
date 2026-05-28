from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_db_tables
from app.routes import matches, players, public, rounds, tournaments
from app.schemas import HealthCheck

app = FastAPI(title="Yu-Gi-Oh Tournament Manager API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(tournaments.router)
app.include_router(players.router)
app.include_router(rounds.router)
app.include_router(matches.router)
app.include_router(public.router)


@app.on_event("startup")
def on_startup() -> None:
    create_db_tables()


@app.get("/health", response_model=HealthCheck)
def health_check() -> HealthCheck:
    return HealthCheck(status="ok")
