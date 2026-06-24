from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Match, Player, PlayoffBracket, PlayoffMatch, Round, Standing, Tournament
from app.schemas import (
    PublicSnapshotMetadataRead,
    PublicSnapshotPairingRead,
    PublicSnapshotPlayoffBracketRead,
    PublicSnapshotPlayoffMatchRead,
    PublicSnapshotPlayoffPlayerRead,
    PublicSnapshotPlayoffRoundRead,
    PublicSnapshotStandingRead,
    PublicTournamentSnapshotRead,
)

BYE_NOTE = "BYE"


def public_playoff_round_name(bracket_size: int, round_index: int) -> str:
    match_count = bracket_size // (2 ** (round_index + 1))
    if match_count == 32:
        return "Round of 64"
    if match_count == 16:
        return "Round of 32"
    if match_count == 8:
        return "Round of 16"
    if match_count == 4:
        return "Quarterfinals"
    if match_count == 2:
        return "Semifinals"
    return "Final"


def build_public_playoff_bracket(db: Session, tournament_id: int) -> PublicSnapshotPlayoffBracketRead | None:
    bracket = db.scalar(
        select(PlayoffBracket)
        .where(PlayoffBracket.tournament_id == tournament_id)
        .order_by(PlayoffBracket.id)
        .limit(1)
    )
    if bracket is None:
        return None

    matches = list(
        db.scalars(
            select(PlayoffMatch)
            .where(PlayoffMatch.bracket_id == bracket.id)
            .order_by(PlayoffMatch.round_index, PlayoffMatch.match_index)
        )
    )
    rounds: list[PublicSnapshotPlayoffRoundRead] = []
    round_indexes = sorted({match.round_index for match in matches})
    for round_index in round_indexes:
        round_matches = [match for match in matches if match.round_index == round_index]
        rounds.append(
            PublicSnapshotPlayoffRoundRead(
                round_index=round_index,
                name=public_playoff_round_name(bracket.size, round_index),
                matches=[
                    PublicSnapshotPlayoffMatchRead(
                        match_index=match.match_index,
                        players=[
                            PublicSnapshotPlayoffPlayerRead(
                                seed=match.player_one_seed,
                                name=match.player_one_name,
                                winner=bool(match.player_one_profile_id and match.winner_profile_id == match.player_one_profile_id),
                            ),
                            PublicSnapshotPlayoffPlayerRead(
                                seed=match.player_two_seed,
                                name=match.player_two_name,
                                winner=bool(match.player_two_profile_id and match.winner_profile_id == match.player_two_profile_id),
                            ),
                        ],
                        winner_name=(
                            match.player_one_name
                            if match.winner_profile_id == match.player_one_profile_id
                            else match.player_two_name
                            if match.winner_profile_id == match.player_two_profile_id
                            else None
                        ),
                    )
                    for match in round_matches
                ],
            )
        )

    final_match = next((match for match in matches if match.round_index == round_indexes[-1] and match.winner_profile_id), None) if round_indexes else None
    champion_name = None
    if final_match is not None:
        champion_name = final_match.player_one_name if final_match.winner_profile_id == final_match.player_one_profile_id else final_match.player_two_name

    return PublicSnapshotPlayoffBracketRead(
        size=bracket.size,
        status=bracket.status,
        champion_name=champion_name,
        rounds=rounds,
    )


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
        playoff_bracket=build_public_playoff_bracket(db, tournament_id),
        metadata=PublicSnapshotMetadataRead(
            total_players=len(players),
            total_rounds=len(rounds),
            unreported_match_count=sum(1 for match in current_round_matches if match.result_status == "UNREPORTED"),
        ),
    )
