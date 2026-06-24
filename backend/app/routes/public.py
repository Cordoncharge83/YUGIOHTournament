from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Player, Round, Standing, Tournament
from app.public_snapshots import build_public_playoff_bracket
from app.schemas import PublicMatchRead, PublicTournamentRead

router = APIRouter(prefix="/public", tags=["public"])
BYE_NOTE = "BYE"


@router.get("/tournaments/{tournament_id}", response_model=PublicTournamentRead)
def get_public_tournament(tournament_id: int, db: Session = Depends(get_db)) -> PublicTournamentRead:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    players = list(
        db.scalars(
            select(Player)
            .where(Player.tournament_id == tournament_id)
            .order_by(Player.name)
        )
    )
    rounds = list(
        db.scalars(
            select(Round)
            .where(Round.tournament_id == tournament_id)
            .order_by(Round.number)
        )
    )
    matches = list(
        db.scalars(
            select(Match)
            .where(Match.tournament_id == tournament_id)
            .order_by(Match.round_id, Match.table_number)
        )
    )
    standings = list(
        db.scalars(
            select(Standing)
            .where(Standing.tournament_id == tournament_id)
            .order_by(Standing.rank)
        )
    )

    player_names = {player.id: player.name for player in players}
    round_numbers = {round_.id: round_.number for round_ in rounds}
    public_matches = [
        PublicMatchRead(
            table_number=match.table_number,
            round_number=round_numbers[match.round_id],
            player_one_name=player_names.get(match.player_one_id, "Unknown player"),
            player_two_name=BYE_NOTE if match.notes == BYE_NOTE and match.player_two_id is None else player_names.get(match.player_two_id),
            player_one_score=match.player_one_score,
            player_two_score=match.player_two_score,
            result_status=match.result_status,
            notes=match.notes,
        )
        for match in matches
    ]

    return PublicTournamentRead(
        tournament=tournament,
        players=players,
        rounds=rounds,
        matches=public_matches,
        standings=standings,
        playoff_bracket=build_public_playoff_bracket(db, tournament_id),
    )
