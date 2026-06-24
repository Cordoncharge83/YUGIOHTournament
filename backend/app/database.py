import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

PROCESS_DATABASE_URL = os.environ.get("DATABASE_URL")
load_dotenv()

DEFAULT_DATABASE_URL = "sqlite:///./data/app.db"
APP_DATA_DIR = os.getenv("APP_DATA_DIR")


def sqlite_url_for_path(database_path: Path) -> str:
    normalized_path = str(database_path.expanduser().resolve()).replace("\\", "/")
    return f"sqlite:///{normalized_path}"


def ensure_app_data_dir(app_data_dir: str | None) -> Path | None:
    if not app_data_dir:
        return None

    app_data_path = Path(app_data_dir).expanduser()
    app_data_path.mkdir(parents=True, exist_ok=True)
    (app_data_path / "logs").mkdir(exist_ok=True)

    settings_path = app_data_path / "settings.json"
    if not settings_path.exists():
        settings_path.write_text("{}\n", encoding="utf-8")

    return app_data_path


APP_DATA_PATH = ensure_app_data_dir(APP_DATA_DIR)

if PROCESS_DATABASE_URL:
    DATABASE_URL = PROCESS_DATABASE_URL
elif APP_DATA_PATH:
    DATABASE_URL = sqlite_url_for_path(APP_DATA_PATH / "app.db")
else:
    DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def create_database_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    connect_args = {}

    if url.drivername.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if url.database and url.database != ":memory:":
            Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)

    return create_engine(database_url, connect_args=connect_args)


engine = create_database_engine(DATABASE_URL)


def get_database_location() -> str:
    if engine.url.drivername.startswith("sqlite"):
        return str(engine.url.database)

    return engine.url.render_as_string(hide_password=True)


@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    if not engine.url.drivername.startswith("sqlite"):
        return

    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def create_db_tables() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "tournaments" in table_names:
        tournament_columns = {column["name"] for column in inspector.get_columns("tournaments")}
        if "kts_file_path" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN kts_file_path TEXT"))
        if "counts_toward_community_stats" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN counts_toward_community_stats BOOLEAN NOT NULL DEFAULT 1"))
        if "publish_status" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN publish_status VARCHAR(32) NOT NULL DEFAULT 'draft'"))
        if "public_id" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN public_id VARCHAR(128)"))
                connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_tournaments_public_id ON tournaments (public_id)"))
        if "public_url" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN public_url TEXT"))
        if "published_at" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN published_at DATETIME"))
        if "last_published_at" not in tournament_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE tournaments ADD COLUMN last_published_at DATETIME"))
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
