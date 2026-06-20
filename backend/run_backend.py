from __future__ import annotations

import multiprocessing
import os
import traceback
from pathlib import Path

import uvicorn


def main() -> None:
    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8000"))
    bootstrap_log("Starting packaged FastAPI backend")

    try:
        from app.main import app
        from app.database import create_db_tables

        bootstrap_log("FastAPI app imported")
        create_db_tables()
        bootstrap_log("Database tables ready")
        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level="info",
            http="h11",
            loop="asyncio",
            log_config=None,
            lifespan="off",
        )
        bootstrap_log("Uvicorn stopped")
    except Exception:
        bootstrap_log(traceback.format_exc())
        raise


def bootstrap_log(message: str) -> None:
    app_data_dir = os.getenv("APP_DATA_DIR")
    if not app_data_dir:
        return

    log_dir = Path(app_data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    with (log_dir / "backend-bootstrap.log").open("a", encoding="utf-8") as log_file:
        log_file.write(message.rstrip())
        log_file.write("\n")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
