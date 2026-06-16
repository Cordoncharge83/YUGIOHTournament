from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.kts_watcher import kts_auto_sync_service
from app.models import Tournament
from app.schemas import AutoSyncEnableRequest, AutoSyncRunNowResponse, AutoSyncStatusRead

router = APIRouter(prefix="/auto-sync", tags=["auto-sync"])


@router.get("/status", response_model=AutoSyncStatusRead)
def get_auto_sync_status() -> dict:
    return kts_auto_sync_service.status()


@router.post("/enable", response_model=AutoSyncStatusRead)
def enable_auto_sync(request: AutoSyncEnableRequest, db: Session = Depends(get_db)) -> dict:
    tournament = db.get(Tournament, request.tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return kts_auto_sync_service.enable(
        tournament_id=tournament.id,
        tournament_name=tournament.name,
        file_path=request.file_path,
    )


@router.post("/disable", response_model=AutoSyncStatusRead)
def disable_auto_sync() -> dict:
    return kts_auto_sync_service.disable()


@router.post("/run-now", response_model=AutoSyncRunNowResponse)
def run_auto_sync_now() -> dict:
    summary, current_status = kts_auto_sync_service.run_now()
    return {"summary": summary, "status": current_status}
