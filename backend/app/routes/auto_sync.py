from fastapi import APIRouter

from app.kts_watcher import kts_auto_sync_service
from app.schemas import AutoSyncStatusRead

router = APIRouter(prefix="/auto-sync", tags=["auto-sync"])


@router.get("/status", response_model=AutoSyncStatusRead)
def get_auto_sync_status() -> dict:
    return kts_auto_sync_service.status()
