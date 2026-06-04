import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def create_db_tables() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "matches" in inspector.get_table_names():
        match_columns = {column["name"] for column in inspector.get_columns("matches")}
        if "result_status" not in match_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE matches ADD COLUMN result_status VARCHAR(32) NOT NULL DEFAULT 'UNREPORTED'")
                )
    if "players" in table_names:
        player_columns = {column["name"] for column in inspector.get_columns("players")}
        if "player_profile_id" not in player_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE players ADD COLUMN player_profile_id INTEGER"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_players_player_profile_id ON players (player_profile_id)"))
    if "standings" in table_names:
        standing_columns = {column["name"] for column in inspector.get_columns("standings")}
        if "player_profile_id" not in standing_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE standings ADD COLUMN player_profile_id INTEGER"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_standings_player_profile_id ON standings (player_profile_id)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
