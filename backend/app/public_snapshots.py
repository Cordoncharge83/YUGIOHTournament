from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Match, Player, Round, Standing, Tournament
from app.schemas import (
    PublicSnapshotMetadataRead,
    PublicSnapshotPairingRead,
    PublicSnapshotStandingRead,
    PublicTournamentSnapshotRead,
)

BYE_NOTE = "BYE"


def build_public_tournament_snapshot(db: Session, tournament: Tournament) -> PublicTournamentSnapshotRead:
    tournament_id = tournament.id
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
    standings = list(
        db.scalars(
            select(Standing)
            .where(Standing.tournament_id == tournament_id)
            .order_by(Standing.rank)
        )
    )

    current_round = None
    if tournament.current_round_id is not None:
        current_round = next((round_ for round_ in rounds if round_.id == tournament.current_round_id), None)

    current_round_matches: list[Match] = []
    if current_round is not None:
        current_round_matches = list(
            db.scalars(
                select(Match)
                .where(Match.round_id == current_round.id)
                .order_by(Match.table_number)
            )
        )

    player_names = {player.id: player.name for player in players}
    current_round_number = current_round.number if current_round is not None else None

    return PublicTournamentSnapshotRead(
        tournament_id=tournament.id,
        tournament_name=tournament.name,
        location=tournament.location,
        current_round_number=current_round_number,
        current_round_name=f"Round {current_round_number}" if current_round_number is not None else None,
        last_updated_at=datetime.now(timezone.utc),
        public_display_status=tournament.publish_status,
        current_round_pairings=[
            PublicSnapshotPairingRead(
                table_number=match.table_number,
                player_one_name=player_names.get(match.player_one_id, "Unknown player"),
                player_two_name=BYE_NOTE if match.notes == BYE_NOTE and match.player_two_id is None else player_names.get(match.player_two_id),
                result_status=match.result_status,
                notes=match.notes,
            )
            for match in current_round_matches
        ],
        standings=[
            PublicSnapshotStandingRead(
                rank=standing.rank,
                player_name=standing.short_name or standing.full_name,
                points=standing.points,
                tiebreaker=standing.tiebreaker,
            )
            for standing in standings
        ],
        metadata=PublicSnapshotMetadataRead(
            total_players=len(players),
            total_rounds=len(rounds),
            unreported_match_count=sum(1 for match in current_round_matches if match.result_status == "UNREPORTED"),
        ),
    )
