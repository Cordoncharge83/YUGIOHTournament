from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Round, Tournament
from app.schemas import RoundCreate, RoundRead

router = APIRouter(tags=["rounds"])


def get_tournament_or_404(tournament_id: int, db: Session) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


@router.post("/tournaments/{tournament_id}/rounds", response_model=RoundRead, status_code=status.HTTP_201_CREATED)
def create_round(
    tournament_id: int,
    round_data: RoundCreate,
    db: Session = Depends(get_db),
) -> Round:
    get_tournament_or_404(tournament_id, db)

    existing_round = db.scalar(
        select(Round).where(
            Round.tournament_id == tournament_id,
            Round.number == round_data.number,
        )
    )
    if existing_round is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Round number already exists for this tournament",
        )

    round_ = Round(tournament_id=tournament_id, **round_data.model_dump())
    db.add(round_)
    db.commit()
    db.refresh(round_)
    return round_


@router.get("/tournaments/{tournament_id}/rounds", response_model=list[RoundRead])
def list_rounds(tournament_id: int, db: Session = Depends(get_db)) -> list[Round]:
    get_tournament_or_404(tournament_id, db)

    statement = select(Round).where(Round.tournament_id == tournament_id).order_by(Round.number)
    return list(db.scalars(statement))


@router.delete("/rounds/{round_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_round(round_id: int, db: Session = Depends(get_db)) -> None:
    round_ = db.get(Round, round_id)
    if round_ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

    existing_match = db.scalar(select(Match).where(Match.round_id == round_id))
    if existing_match is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a round that has matches",
        )

    tournament = db.get(Tournament, round_.tournament_id)
    if tournament and tournament.current_round_id == round_id:
        tournament.current_round_id = None

    db.delete(round_)
    db.commit()
