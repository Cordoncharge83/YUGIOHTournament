from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Player, Round, Tournament
from app.schemas import MatchCreate, MatchRead, MatchResultUpdate

router = APIRouter(tags=["matches"])


def get_tournament_or_404(tournament_id: int, db: Session) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


def get_round_or_404(round_id: int, db: Session) -> Round:
    round_ = db.get(Round, round_id)
    if round_ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

    return round_


def validate_round_belongs_to_tournament(round_: Round, tournament_id: int) -> None:
    if round_.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Round does not belong to tournament")


def validate_player_belongs_to_tournament(player_id: int, tournament_id: int, db: Session) -> Player:
    player = db.get(Player, player_id)
    if player is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    if player.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Player does not belong to tournament")

    return player


@router.post("/tournaments/{tournament_id}/matches", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def create_match(
    tournament_id: int,
    match_data: MatchCreate,
    db: Session = Depends(get_db),
) -> Match:
    get_tournament_or_404(tournament_id, db)

    if match_data.player_one_id == match_data.player_two_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A player cannot be matched against themselves",
        )

    round_ = get_round_or_404(match_data.round_id, db)
    validate_round_belongs_to_tournament(round_, tournament_id)
    validate_player_belongs_to_tournament(match_data.player_one_id, tournament_id, db)
    validate_player_belongs_to_tournament(match_data.player_two_id, tournament_id, db)

    existing_table_match = db.scalar(
        select(Match).where(
            Match.round_id == match_data.round_id,
            Match.table_number == match_data.table_number,
        )
    )
    if existing_table_match is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Table number already has a match in this round",
        )

    existing_player_match = db.scalar(
        select(Match).where(
            Match.round_id == match_data.round_id,
            or_(
                Match.player_one_id.in_([match_data.player_one_id, match_data.player_two_id]),
                Match.player_two_id.in_([match_data.player_one_id, match_data.player_two_id]),
            ),
        )
    )
    if existing_player_match is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One of these players is already assigned to a match in this round",
        )

    match = Match(tournament_id=tournament_id, **match_data.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


@router.delete("/matches/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_match(match_id: int, db: Session = Depends(get_db)) -> None:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

    db.delete(match)
    db.commit()


@router.get("/tournaments/{tournament_id}/matches", response_model=list[MatchRead])
def list_tournament_matches(tournament_id: int, db: Session = Depends(get_db)) -> list[Match]:
    get_tournament_or_404(tournament_id, db)

    statement = select(Match).where(Match.tournament_id == tournament_id).order_by(Match.round_id, Match.table_number)
    return list(db.scalars(statement))


@router.get("/rounds/{round_id}/matches", response_model=list[MatchRead])
def list_round_matches(round_id: int, db: Session = Depends(get_db)) -> list[Match]:
    get_round_or_404(round_id, db)

    statement = select(Match).where(Match.round_id == round_id).order_by(Match.table_number)
    return list(db.scalars(statement))


@router.patch("/matches/{match_id}/result", response_model=MatchRead)
def update_match_result(
    match_id: int,
    result_data: MatchResultUpdate,
    db: Session = Depends(get_db),
) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

    round_ = get_round_or_404(match.round_id, db)
    validate_round_belongs_to_tournament(round_, match.tournament_id)

    match.result_status = result_data.result_status

    db.commit()
    db.refresh(match)
    return match
