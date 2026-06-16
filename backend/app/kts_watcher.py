import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from xml.etree.ElementTree import ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring
from fastapi import HTTPException, status

from app.database import SessionLocal
from app.routes.tournaments import import_parsed_tournament_file, parse_tournament_file
from app.schemas import TournamentFileImportSummary

try:
    from watchdog.events import FileSystemEvent, FileSystemEventHandler
    from watchdog.observers import Observer
except ImportError:  # pragma: no cover - depends on optional local installation state
    FileSystemEvent = object
    FileSystemEventHandler = object
    Observer = None

logger = logging.getLogger(__name__)


class KtsAutoSyncService:
    def __init__(self, debounce_seconds: float = 1.5) -> None:
        self.debounce_seconds = debounce_seconds
        self.file_path: Path | None = None
        self.tournament_id: int | None = None
        self.tournament_name: str | None = None
        self.enabled = False
        self._observer = None
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._last_sync_at: datetime | None = None
        self._last_status: str | None = None
        self._last_error: str | None = None

    def enable(self, tournament_id: int, tournament_name: str | None, file_path: str) -> dict:
        if Observer is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Python watchdog is not installed",
            )

        watched_file = self._validated_tournament_file(file_path)
        self.stop(clear_session=False)

        with self._lock:
            self.file_path = watched_file
            self.tournament_id = tournament_id
            self.tournament_name = tournament_name
            self.enabled = True
            self._last_status = "Starting watcher"
            self._last_error = None

        observer = Observer()
        observer.schedule(_KtsFileEventHandler(self), str(watched_file.parent), recursive=False)
        observer.start()

        with self._lock:
            self._observer = observer
            self._last_status = "Watching"

        logger.info("KTS auto-sync enabled for tournament %s watching %s", tournament_id, watched_file)
        return self.status()

    def disable(self) -> dict:
        self.stop(clear_session=True)
        with self._lock:
            self._last_status = "Disabled"
            self._last_error = None

        logger.info("KTS auto-sync disabled")
        return self.status()

    def stop(self, clear_session: bool = False) -> None:
        timer = None
        observer = None
        with self._lock:
            timer = self._timer
            self._timer = None
            observer = self._observer
            self._observer = None

            if clear_session:
                self.file_path = None
                self.tournament_id = None
                self.tournament_name = None
                self.enabled = False

        if timer is not None:
            timer.cancel()

        if observer is not None:
            observer.stop()
            observer.join(timeout=5)
            logger.info("KTS auto-sync watcher stopped")

    def status(self) -> dict:
        with self._lock:
            file_path = self.file_path
            return {
                "enabled": self.enabled,
                "tournament_id": self.tournament_id,
                "tournament_name": self.tournament_name,
                "file_path": str(file_path) if file_path else None,
                "file_name": file_path.name if file_path else None,
                "file_exists": file_path.exists() if file_path else False,
                "last_sync_at": self._last_sync_at,
                "last_status": self._last_status,
                "last_error": self._last_error,
            }

    def run_now(self) -> tuple[TournamentFileImportSummary, dict]:
        summary = self._import_active_file(raise_errors=True)
        return summary, self.status()

    def handle_file_event(self, event_path: str) -> None:
        if not self._is_watched_file(event_path):
            return

        logger.info("KTS auto-sync detected change for %s", event_path)
        with self._lock:
            self._last_status = "Change detected; waiting for file write to finish"
            self._last_error = None

            if self._timer is not None:
                self._timer.cancel()

            self._timer = threading.Timer(self.debounce_seconds, self._import_from_timer)
            self._timer.daemon = True
            self._timer.start()

    def _import_from_timer(self) -> None:
        try:
            self._import_active_file(raise_errors=False)
        except Exception:
            pass
        finally:
            with self._lock:
                self._timer = None

    def _import_active_file(self, raise_errors: bool) -> TournamentFileImportSummary:
        with self._lock:
            file_path = self.file_path
            tournament_id = self.tournament_id
            enabled = self.enabled
            self._last_status = "Importing"
            self._last_error = None

        if not enabled or file_path is None or tournament_id is None:
            message = "Auto-sync is not enabled"
            self._record_import_error(None, message, include_exception=False)
            if raise_errors:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
            raise RuntimeError(message)

        db = SessionLocal()
        try:
            if not file_path.exists():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Auto-sync file path does not exist")

            root = fromstring(file_path.read_bytes())
            summary = import_parsed_tournament_file(db, tournament_id, parse_tournament_file(root))
            message = (
                f"Imported {summary.players_imported} players, {summary.rounds_imported} rounds, "
                f"{summary.matches_imported} matches, and {summary.standings_imported} standings entries"
            )
            with self._lock:
                self._last_sync_at = datetime.now(timezone.utc)
                self._last_status = message
                self._last_error = None
            logger.info("KTS auto-sync import succeeded for %s: %s", file_path, message)
            return summary
        except HTTPException as exc:
            db.rollback()
            self._record_import_error(file_path, str(exc.detail))
            if raise_errors:
                raise
            raise
        except (DefusedXmlException, ParseError) as exc:
            db.rollback()
            message = f"KTS file must be valid XML: {exc}"
            self._record_import_error(file_path, message)
            if raise_errors:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message) from exc
            raise
        except Exception as exc:
            db.rollback()
            self._record_import_error(file_path, str(exc))
            if raise_errors:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
            raise
        finally:
            db.close()

    def _validated_tournament_file(self, file_path: str) -> Path:
        watched_file = Path(file_path.strip()).expanduser()
        if watched_file.suffix.casefold() != ".tournament":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Auto-sync file path must end with .Tournament",
            )
        if not watched_file.exists():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Auto-sync file path does not exist",
            )
        if not watched_file.is_file():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Auto-sync file path must point to a file",
            )

        return watched_file.resolve()

    def _is_watched_file(self, event_path: str) -> bool:
        with self._lock:
            file_path = self.file_path

        if file_path is None:
            return False

        try:
            return os.path.normcase(str(Path(event_path).resolve())) == os.path.normcase(str(file_path))
        except OSError:
            return False

    def _record_import_error(self, file_path: Path | None, message: str, include_exception: bool = True) -> None:
        with self._lock:
            self._last_sync_at = datetime.now(timezone.utc)
            self._last_status = "Import failed"
            self._last_error = message

        if include_exception:
            logger.exception("KTS auto-sync import failed for %s: %s", file_path, message)
        else:
            logger.error("KTS auto-sync import failed for %s: %s", file_path, message)


class _KtsFileEventHandler(FileSystemEventHandler):
    def __init__(self, service: KtsAutoSyncService) -> None:
        self.service = service

    def on_created(self, event: FileSystemEvent) -> None:
        self._handle(event)

    def on_modified(self, event: FileSystemEvent) -> None:
        self._handle(event)

    def on_moved(self, event: FileSystemEvent) -> None:
        self._handle(event)
        dest_path = getattr(event, "dest_path", None)
        if dest_path:
            self.service.handle_file_event(dest_path)

    def _handle(self, event: FileSystemEvent) -> None:
        if getattr(event, "is_directory", False):
            return

        self.service.handle_file_event(str(event.src_path))


kts_auto_sync_service = KtsAutoSyncService()
