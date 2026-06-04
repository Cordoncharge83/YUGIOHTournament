from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Player, Tournament
from app.player_profiles import get_or_create_player_profile
from app.schemas import PlayerCreate, PlayerRead

router = APIRouter(prefix="/tournaments/{tournament_id}/players", tags=["players"])


def get_tournament_or_404(tournament_id: int, db: Session) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


@router.post("", response_model=PlayerRead, status_code=status.HTTP_201_CREATED)
def create_player(
    tournament_id: int,
    player_data: PlayerCreate,
    db: Session = Depends(get_db),
) -> Player:
    get_tournament_or_404(tournament_id, db)

    profile = get_or_create_player_profile(db, player_data.name)
    player = Player(tournament_id=tournament_id, player_profile_id=profile.id, **player_data.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


@router.get("", response_model=list[PlayerRead])
def list_players(tournament_id: int, db: Session = Depends(get_db)) -> list[Player]:
    get_tournament_or_404(tournament_id, db)

    statement = select(Player).where(Player.tournament_id == tournament_id).order_by(Player.id)
    return list(db.scalars(statement))
