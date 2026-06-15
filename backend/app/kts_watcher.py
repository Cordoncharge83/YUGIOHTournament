import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from xml.etree.ElementTree import ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring
from fastapi import HTTPException

from app.database import SessionLocal
from app.routes.tournaments import import_parsed_tournament_file, parse_tournament_file

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
        self.watch_file: Path | None = None
        self.tournament_id: int | None = None
        self.enabled = False
        self._observer = None
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._last_file: str | None = None
        self._last_sync_at: datetime | None = None
        self._last_status: str | None = None
        self._last_error: str | None = None

    def configure_from_env(self) -> None:
        watch_file_value = os.getenv("KTS_WATCH_FILE")
        tournament_id_value = os.getenv("KTS_AUTO_SYNC_TOURNAMENT_ID")

        with self._lock:
            self.enabled = False
            self.watch_file = Path(watch_file_value).expanduser() if watch_file_value else None
            self.tournament_id = None
            self._last_error = None
            self._last_status = None

        if not watch_file_value or not tournament_id_value:
            logger.info("KTS auto-sync disabled: KTS_WATCH_FILE or KTS_AUTO_SYNC_TOURNAMENT_ID is not configured")
            return

        try:
            tournament_id = int(tournament_id_value)
        except ValueError:
            self._set_error("KTS_AUTO_SYNC_TOURNAMENT_ID must be an integer")
            logger.warning("KTS auto-sync disabled: KTS_AUTO_SYNC_TOURNAMENT_ID must be an integer")
            return

        watch_file = Path(watch_file_value).expanduser()
        if not watch_file.exists():
            self._set_error("Configured KTS_WATCH_FILE does not exist")
            logger.warning("KTS auto-sync disabled: configured file does not exist: %s", watch_file)
            return

        if Observer is None:
            self._set_error("Python watchdog is not installed")
            logger.warning("KTS auto-sync disabled: Python watchdog is not installed")
            return

        with self._lock:
            self.watch_file = watch_file.resolve()
            self.tournament_id = tournament_id
            self.enabled = True
            self._last_status = "Watching"

    def start(self) -> None:
        self.stop()
        self.configure_from_env()
        if not self.enabled or self.watch_file is None:
            return

        parent_folder = self.watch_file.parent
        handler = _KtsFileEventHandler(self)
        observer = Observer()
        observer.schedule(handler, str(parent_folder), recursive=False)
        observer.start()
        self._observer = observer
        logger.info("KTS auto-sync watching %s for tournament %s", self.watch_file, self.tournament_id)

    def stop(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

        if self._observer is not None:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
            logger.info("KTS auto-sync watcher stopped")

    def status(self) -> dict:
        with self._lock:
            return {
                "enabled": self.enabled,
                "watch_file": str(self.watch_file) if self.watch_file else None,
                "tournament_id": self.tournament_id,
                "last_file": self._last_file,
                "last_sync_at": self._last_sync_at,
                "last_status": self._last_status,
                "last_error": self._last_error,
            }

    def handle_file_event(self, event_path: str) -> None:
        if not self._is_watched_file(event_path):
            return

        logger.info("KTS auto-sync detected change for %s", event_path)
        with self._lock:
            self._last_file = str(self.watch_file) if self.watch_file else event_path
            self._last_status = "Change detected; waiting for file write to finish"
            self._last_error = None

        if self._timer is not None:
            self._timer.cancel()

        self._timer = threading.Timer(self.debounce_seconds, self._import_watched_file)
        self._timer.daemon = True
        self._timer.start()

    def _is_watched_file(self, event_path: str) -> bool:
        with self._lock:
            watch_file = self.watch_file

        if watch_file is None:
            return False

        try:
            return os.path.normcase(str(Path(event_path).resolve())) == os.path.normcase(str(watch_file))
        except OSError:
            return False

    def _import_watched_file(self) -> None:
        with self._lock:
            watch_file = self.watch_file
            tournament_id = self.tournament_id
            self._last_status = "Importing"
            self._last_error = None

        if watch_file is None or tournament_id is None:
            return

        db = SessionLocal()
        try:
            root = fromstring(watch_file.read_bytes())
            summary = import_parsed_tournament_file(db, tournament_id, parse_tournament_file(root))
            message = (
                f"Imported {summary.players_imported} players, {summary.rounds_imported} rounds, "
                f"{summary.matches_imported} matches, and {summary.standings_imported} standings entries"
            )
            with self._lock:
                self._last_file = str(watch_file)
                self._last_sync_at = datetime.now(timezone.utc)
                self._last_status = message
                self._last_error = None
            logger.info("KTS auto-sync succeeded for %s: %s", watch_file, message)
        except HTTPException as exc:
            db.rollback()
            self._record_import_error(watch_file, str(exc.detail))
        except (DefusedXmlException, ParseError) as exc:
            db.rollback()
            self._record_import_error(watch_file, f"KTS file must be valid XML: {exc}")
        except Exception as exc:
            db.rollback()
            self._record_import_error(watch_file, str(exc))
        finally:
            db.close()

    def _record_import_error(self, watch_file: Path, message: str) -> None:
        with self._lock:
            self._last_file = str(watch_file)
            self._last_sync_at = datetime.now(timezone.utc)
            self._last_status = "Import failed"
            self._last_error = message
        logger.exception("KTS auto-sync failed for %s: %s", watch_file, message)

    def _set_error(self, message: str) -> None:
        with self._lock:
            self._last_error = message
            self._last_status = "Disabled"


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
