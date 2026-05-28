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
    if "matches" in inspector.get_table_names():
        match_columns = {column["name"] for column in inspector.get_columns("matches")}
        if "result_status" not in match_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE matches ADD COLUMN result_status VARCHAR(32) NOT NULL DEFAULT 'UNREPORTED'")
                )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
