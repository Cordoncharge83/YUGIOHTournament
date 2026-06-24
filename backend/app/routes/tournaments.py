import csv
import logging
from datetime import datetime, timezone
from io import StringIO
from typing import Any
from xml.etree.ElementTree import Element, ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Player, PlayerProfile, PlayoffBracket, PlayoffMatch, Round, Standing, Tournament
from app.player_profiles import get_or_create_player_profile
from app.public_publishing_client import (
    PublicPublishingConfigurationError,
    PublicPublishingRemoteError,
    get_public_publishing_config,
    publish_snapshot,
    unpublish_snapshot,
)
from app.publishing import build_publish_payload, ensure_public_id, publish_tournament, unpublish_tournament
from app.public_snapshots import build_public_tournament_snapshot
from app.schemas import (
    PublicTournamentSnapshotRead,
    PublicPublishingConfigRead,
    RoundCsvImportSummary,
    RoundCsvPreviewSummary,
    PlayoffBracketRead,
    PlayoffCreate,
    PlayoffMatchRead,
    PlayoffWinnerUpdate,
    StandingRead,
    StandingsCsvImportSummary,
    TournamentPublishStatusRead,
    TournamentCreate,
    TournamentCommunityStatsUpdate,
    TournamentCurrentRoundUpdate,
    TournamentFileImportSummary,
    TournamentRead,
)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])
logger = logging.getLogger(__name__)
KTS_BYE_VALUE = "***BYE***"
KTS_ZERO_BYE_VALUE = "0"
BYE_NOTE = "BYE"
BYE_VALUES = {KTS_BYE_VALUE.casefold(), KTS_ZERO_BYE_VALUE, BYE_NOTE.casefold()}
ALLOWED_PLAYOFF_SIZES = {4, 8, 16, 32, 64}
BACKUP_APP_MARKER = "Yu-Gi-Oh Tournament Manager"
BACKUP_VERSION = 1


def validate_playoff_size(size: int) -> None:
    if size not in ALLOWED_PLAYOFF_SIZES or size & (size - 1) != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Playoff size must be one of: 4, 8, 16, 32, 64.",
        )


def protected_playoff_seed_order(size: int) -> list[int]:
    seed_order = [1, 2]
    while len(seed_order) < size:
        next_size = len(seed_order) * 2
        seed_order = [seed for existing_seed in seed_order for seed in (existing_seed, next_size + 1 - existing_seed)]

    return seed_order


def protected_playoff_seed_pairings(size: int) -> list[tuple[int, int]]:
    seed_order = protected_playoff_seed_order(size)
    return list(zip(seed_order[::2], seed_order[1::2], strict=True))


def is_bye(value: str | None) -> bool:
    normalized_value = (value or "").strip().casefold().replace(" ", "")
    return normalized_value in BYE_VALUES


def xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def direct_child(element: Element, name: str) -> Element | None:
    for child in list(element):
        if xml_local_name(child.tag) == name:
            return child

    return None


def direct_children(element: Element, name: str) -> list[Element]:
    return [child for child in list(element) if xml_local_name(child.tag) == name]


def child_text(element: Element, name: str) -> str | None:
    child = direct_child(element, name)
    if child is None or child.text is None:
        return None

    value = child.text.strip()
    return value or None


def nested_child_text(element: Element, path: tuple[str, ...]) -> str | None:
    current = element
    for name in path:
        next_element = direct_child(current, name)
        if next_element is None:
            return None
        current = next_element

    if current.text is None:
        return None

    value = current.text.strip()
    return value or None


def parse_optional_int(value: str | None, field_name: str) -> int | None:
    if value is None or not value.strip():
        return None

    try:
        return int(value.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"KTS file has an invalid {field_name}",
        ) from exc


def kts_player_name(tourn_player: Element) -> str | None:
    first_name = nested_child_text(tourn_player, ("Player", "FirstName")) or ""
    last_name = nested_child_text(tourn_player, ("Player", "LastName")) or ""
    first_name = first_name.strip()
    last_name = last_name.strip()

    if last_name and first_name:
        return f"{last_name}, {first_name}"
    if last_name:
        return last_name
    if first_name:
        return first_name

    return None


def kts_match_player_id(player_element: Element | None) -> str | None:
    if player_element is None:
        return None

    player_id = child_text(player_element, "ID")
    if player_id:
        return player_id

    if player_element.text:
        player_id = player_element.text.strip()
        if player_id:
            return player_id

    return None


def kts_result_status(status_value: str | None, winner_id: str | None, player_one_id: str | None, player_two_id: str | None) -> str:
    normalized_status = (status_value or "").strip().casefold().replace(" ", "")
    normalized_winner = (winner_id or "").strip()

    if normalized_status == "draw":
        return "DRAW"
    if normalized_status == "doubleloss":
        return "DOUBLE_LOSS"
    if normalized_winner and player_one_id and normalized_winner == player_one_id:
        return "PLAYER_ONE_WIN"
    if normalized_winner and player_two_id and normalized_winner == player_two_id:
        return "PLAYER_TWO_WIN"

    return "UNREPORTED"


def playoff_match_read(match: PlayoffMatch) -> PlayoffMatchRead:
    return PlayoffMatchRead(
        id=match.id,
        bracket_id=match.bracket_id,
        round_index=match.round_index,
        match_index=match.match_index,
        player_one_id=match.player_one_profile_id,
        player_two_id=match.player_two_profile_id,
        player_one_name=match.player_one_name,
        player_two_name=match.player_two_name,
        player_one_seed=match.player_one_seed,
        player_two_seed=match.player_two_seed,
        winner_player_id=match.winner_profile_id,
        created_at=match.created_at,
        updated_at=match.updated_at,
    )


def playoff_bracket_read(bracket: PlayoffBracket) -> PlayoffBracketRead:
    return PlayoffBracketRead(
        id=bracket.id,
        tournament_id=bracket.tournament_id,
        size=bracket.size,
        status=bracket.status,
        created_at=bracket.created_at,
        updated_at=bracket.updated_at,
        matches=[
            playoff_match_read(match)
            for match in sorted(bracket.matches, key=lambda item: (item.round_index, item.match_index))
        ],
    )


def get_tournament_playoff_bracket(db: Session, tournament_id: int) -> PlayoffBracket | None:
    return db.scalar(
        select(PlayoffBracket)
        .where(PlayoffBracket.tournament_id == tournament_id)
        .order_by(PlayoffBracket.id)
        .limit(1)
    )


def backup_datetime(value) -> str | None:
    return value.isoformat() if value is not None else None


def next_backup_ref(prefix: str, index: int) -> str:
    return f"{prefix}-{index}"


def backup_profile_payload(profile: PlayerProfile, profile_ref: str) -> dict[str, str | None]:
    return {
        "ref": profile_ref,
        "display_name": profile.display_name,
        "cossy_id": profile.cossy_id,
    }


def build_tournament_backup(db: Session, tournament: Tournament) -> dict[str, Any]:
    players = list(db.scalars(select(Player).where(Player.tournament_id == tournament.id).order_by(Player.id)))
    rounds = list(db.scalars(select(Round).where(Round.tournament_id == tournament.id).order_by(Round.number, Round.id)))
    matches = list(db.scalars(select(Match).where(Match.tournament_id == tournament.id).order_by(Match.round_id, Match.table_number, Match.id)))
    standings = list(db.scalars(select(Standing).where(Standing.tournament_id == tournament.id).order_by(Standing.rank)))
    bracket = get_tournament_playoff_bracket(db, tournament.id)

    profiles_by_id: dict[int, PlayerProfile] = {}
    for player in players:
        if player.player_profile is not None:
            profiles_by_id[player.player_profile.id] = player.player_profile
    for standing in standings:
        if standing.player_profile is not None:
            profiles_by_id[standing.player_profile.id] = standing.player_profile
    if bracket is not None:
        for playoff_match in bracket.matches:
            for profile in (playoff_match.player_one_profile, playoff_match.player_two_profile, playoff_match.winner_profile):
                if profile is not None:
                    profiles_by_id[profile.id] = profile

    profile_refs = {
        profile_id: next_backup_ref("profile", index)
        for index, profile_id in enumerate(sorted(profiles_by_id), start=1)
    }
    player_refs = {
        player.id: next_backup_ref("player", index)
        for index, player in enumerate(players, start=1)
    }
    round_refs = {
        round_.id: next_backup_ref("round", index)
        for index, round_ in enumerate(rounds, start=1)
    }

    playoff_payload = None
    if bracket is not None:
        playoff_matches = sorted(bracket.matches, key=lambda match: (match.round_index, match.match_index))
        playoff_payload = {
            "size": bracket.size,
            "status": bracket.status,
            "created_at": backup_datetime(bracket.created_at),
            "updated_at": backup_datetime(bracket.updated_at),
            "matches": [
                {
                    "round_index": match.round_index,
                    "match_index": match.match_index,
                    "player_one_profile_ref": profile_refs.get(match.player_one_profile_id),
                    "player_two_profile_ref": profile_refs.get(match.player_two_profile_id),
                    "winner_profile_ref": profile_refs.get(match.winner_profile_id),
                    "player_one_name": match.player_one_name,
                    "player_two_name": match.player_two_name,
                    "player_one_seed": match.player_one_seed,
                    "player_two_seed": match.player_two_seed,
                }
                for match in playoff_matches
            ],
        }

    return {
        "backup_version": BACKUP_VERSION,
        "app": BACKUP_APP_MARKER,
        "exported_at": backup_datetime(datetime.now(timezone.utc)),
        "tournament": {
            "name": tournament.name,
            "location": tournament.location,
            "created_at": backup_datetime(tournament.created_at),
            "counts_toward_community_stats": tournament.counts_toward_community_stats,
            "publish_metadata": {
                "publish_status": tournament.publish_status,
                "public_id": tournament.public_id,
                "public_url": tournament.public_url,
                "published_at": backup_datetime(tournament.published_at),
                "last_published_at": backup_datetime(tournament.last_published_at),
            },
            "current_round_ref": round_refs.get(tournament.current_round_id),
        },
        "player_profiles": [
            backup_profile_payload(profiles_by_id[profile_id], profile_refs[profile_id])
            for profile_id in sorted(profiles_by_id)
        ],
        "players": [
            {
                "ref": player_refs[player.id],
                "name": player.name,
                "profile_ref": profile_refs.get(player.player_profile_id),
            }
            for player in players
        ],
        "rounds": [
            {
                "ref": round_refs[round_.id],
                "number": round_.number,
            }
            for round_ in rounds
        ],
        "matches": [
            {
                "round_ref": round_refs.get(match.round_id),
                "table_number": match.table_number,
                "player_one_ref": player_refs.get(match.player_one_id),
                "player_two_ref": player_refs.get(match.player_two_id),
                "player_one_score": match.player_one_score,
                "player_two_score": match.player_two_score,
                "result_status": match.result_status,
                "notes": match.notes,
            }
            for match in matches
        ],
        "standings": [
            {
                "profile_ref": profile_refs.get(standing.player_profile_id),
                "rank": standing.rank,
                "full_name": standing.full_name,
                "short_name": standing.short_name,
                "cossy_id": standing.cossy_id,
                "points": standing.points,
                "tiebreaker": standing.tiebreaker,
            }
            for standing in standings
        ],
        "playoff_bracket": playoff_payload,
    }


def require_backup_dict(value: Any, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Backup field '{field_name}' must be an object.")
    return value


def require_backup_list(value: Any, field_name: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Backup field '{field_name}' must be a list.")
    return value


def backup_string(value: Any, fallback: str | None = None) -> str | None:
    if value is None:
        return fallback
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or fallback
    return fallback


def backup_int(value: Any, field_name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Backup field '{field_name}' must be a number.") from exc


def unique_imported_tournament_name(db: Session, original_name: str) -> str:
    base_name = backup_string(original_name, "Imported Tournament") or "Imported Tournament"
    imported_name = f"{base_name} (Imported)"
    existing_names = set(db.scalars(select(Tournament.name)))
    if imported_name not in existing_names:
        return imported_name

    suffix = 2
    while f"{base_name} (Imported {suffix})" in existing_names:
        suffix += 1
    return f"{base_name} (Imported {suffix})"


def import_tournament_backup_payload(db: Session, backup: dict[str, Any]) -> Tournament:
    if backup.get("backup_version") != BACKUP_VERSION or backup.get("app") != BACKUP_APP_MARKER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported or invalid tournament backup file.")

    tournament_payload = require_backup_dict(backup.get("tournament"), "tournament")
    tournament = Tournament(
        name=unique_imported_tournament_name(db, backup_string(tournament_payload.get("name"), "Imported Tournament") or "Imported Tournament"),
        location=backup_string(tournament_payload.get("location")),
        counts_toward_community_stats=tournament_payload.get("counts_toward_community_stats") is not False,
        publish_status="draft",
        public_id=None,
        public_url=None,
        kts_file_path=None,
    )
    db.add(tournament)
    db.flush()

    profiles_by_ref: dict[str, PlayerProfile] = {}
    for profile_payload in require_backup_list(backup.get("player_profiles"), "player_profiles"):
        profile_data = require_backup_dict(profile_payload, "player_profiles[]")
        profile_ref = backup_string(profile_data.get("ref"))
        display_name = backup_string(profile_data.get("display_name"))
        if not profile_ref or not display_name:
            continue
        profiles_by_ref[profile_ref] = get_or_create_player_profile(db, display_name, backup_string(profile_data.get("cossy_id")))

    players_by_ref: dict[str, Player] = {}
    for player_payload in require_backup_list(backup.get("players"), "players"):
        player_data = require_backup_dict(player_payload, "players[]")
        player_ref = backup_string(player_data.get("ref"))
        player_name = backup_string(player_data.get("name"))
        if not player_ref or not player_name:
            continue
        profile = profiles_by_ref.get(backup_string(player_data.get("profile_ref")) or "")
        player = Player(
            tournament_id=tournament.id,
            player_profile_id=profile.id if profile else None,
            name=player_name,
        )
        db.add(player)
        db.flush()
        players_by_ref[player_ref] = player

    rounds_by_ref: dict[str, Round] = {}
    for round_payload in require_backup_list(backup.get("rounds"), "rounds"):
        round_data = require_backup_dict(round_payload, "rounds[]")
        round_ref = backup_string(round_data.get("ref"))
        round_number = backup_int(round_data.get("number"), "rounds[].number")
        if not round_ref or round_number < 1:
            continue
        round_ = Round(tournament_id=tournament.id, number=round_number)
        db.add(round_)
        db.flush()
        rounds_by_ref[round_ref] = round_

    current_round_ref = backup_string(tournament_payload.get("current_round_ref"))
    if current_round_ref and current_round_ref in rounds_by_ref:
        tournament.current_round_id = rounds_by_ref[current_round_ref].id

    for match_payload in require_backup_list(backup.get("matches"), "matches"):
        match_data = require_backup_dict(match_payload, "matches[]")
        round_ = rounds_by_ref.get(backup_string(match_data.get("round_ref")) or "")
        player_one = players_by_ref.get(backup_string(match_data.get("player_one_ref")) or "")
        player_two_ref = backup_string(match_data.get("player_two_ref"))
        player_two = players_by_ref.get(player_two_ref or "") if player_two_ref else None
        if round_ is None or player_one is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup match references a missing round or player.")
        if player_two_ref and player_two is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup match references a missing player.")
        db.add(
            Match(
                tournament_id=tournament.id,
                round_id=round_.id,
                table_number=match_data.get("table_number"),
                player_one_id=player_one.id,
                player_two_id=player_two.id if player_two else None,
                player_one_score=match_data.get("player_one_score"),
                player_two_score=match_data.get("player_two_score"),
                result_status=backup_string(match_data.get("result_status"), "UNREPORTED") or "UNREPORTED",
                notes=backup_string(match_data.get("notes")),
            )
        )

    for standing_payload in require_backup_list(backup.get("standings"), "standings"):
        standing_data = require_backup_dict(standing_payload, "standings[]")
        rank = backup_int(standing_data.get("rank"), "standings[].rank")
        points = backup_int(standing_data.get("points"), "standings[].points")
        full_name = backup_string(standing_data.get("full_name"))
        if not full_name:
            continue
        profile = profiles_by_ref.get(backup_string(standing_data.get("profile_ref")) or "")
        if profile is None:
            profile = get_or_create_player_profile(db, full_name, backup_string(standing_data.get("cossy_id")))
        db.add(
            Standing(
                tournament_id=tournament.id,
                player_profile_id=profile.id if profile else None,
                rank=rank,
                full_name=full_name,
                short_name=backup_string(standing_data.get("short_name")),
                cossy_id=backup_string(standing_data.get("cossy_id")),
                points=points,
                tiebreaker=backup_string(standing_data.get("tiebreaker")),
            )
        )

    playoff_payload = backup.get("playoff_bracket")
    if playoff_payload is not None:
        playoff_data = require_backup_dict(playoff_payload, "playoff_bracket")
        playoff_size = backup_int(playoff_data.get("size"), "playoff_bracket.size")
        validate_playoff_size(playoff_size)
        bracket = PlayoffBracket(
            tournament_id=tournament.id,
            size=playoff_size,
            status=backup_string(playoff_data.get("status"), "active") or "active",
        )
        db.add(bracket)
        db.flush()
        for playoff_match_payload in require_backup_list(playoff_data.get("matches"), "playoff_bracket.matches"):
            match_data = require_backup_dict(playoff_match_payload, "playoff_bracket.matches[]")
            player_one_profile = profiles_by_ref.get(backup_string(match_data.get("player_one_profile_ref")) or "")
            player_two_profile = profiles_by_ref.get(backup_string(match_data.get("player_two_profile_ref")) or "")
            winner_profile = profiles_by_ref.get(backup_string(match_data.get("winner_profile_ref")) or "")
            db.add(
                PlayoffMatch(
                    bracket_id=bracket.id,
                    round_index=backup_int(match_data.get("round_index"), "playoff_bracket.matches[].round_index"),
                    match_index=backup_int(match_data.get("match_index"), "playoff_bracket.matches[].match_index"),
                    player_one_profile_id=player_one_profile.id if player_one_profile else None,
                    player_two_profile_id=player_two_profile.id if player_two_profile else None,
                    winner_profile_id=winner_profile.id if winner_profile else None,
                    player_one_name=backup_string(match_data.get("player_one_name")),
                    player_two_name=backup_string(match_data.get("player_two_name")),
                    player_one_seed=match_data.get("player_one_seed"),
                    player_two_seed=match_data.get("player_two_seed"),
                )
            )

    db.commit()
    db.refresh(tournament)
    return tournament


def playoff_slot_for_winner(match: PlayoffMatch) -> dict[str, int | str | None]:
    if match.winner_profile_id == match.player_one_profile_id:
        return {
            "profile_id": match.player_one_profile_id,
            "name": match.player_one_name,
            "seed": match.player_one_seed,
        }
    if match.winner_profile_id == match.player_two_profile_id:
        return {
            "profile_id": match.player_two_profile_id,
            "name": match.player_two_name,
            "seed": match.player_two_seed,
        }

    return {"profile_id": None, "name": None, "seed": None}


def set_playoff_match_slot(match: PlayoffMatch, slot: int, player: dict[str, int | str | None]) -> None:
    if slot == 0:
        match.player_one_profile_id = player["profile_id"]
        match.player_one_name = player["name"]
        match.player_one_seed = player["seed"]
    else:
        match.player_two_profile_id = player["profile_id"]
        match.player_two_name = player["name"]
        match.player_two_seed = player["seed"]


def recompute_playoff_advancement(bracket: PlayoffBracket) -> None:
    matches_by_round: dict[int, list[PlayoffMatch]] = {}
    for match in bracket.matches:
        matches_by_round.setdefault(match.round_index, []).append(match)

    round_indexes = sorted(matches_by_round)
    for round_index in round_indexes:
        matches_by_round[round_index].sort(key=lambda item: item.match_index)

    for round_index in round_indexes[1:]:
        for match in matches_by_round[round_index]:
            set_playoff_match_slot(match, 0, {"profile_id": None, "name": None, "seed": None})
            set_playoff_match_slot(match, 1, {"profile_id": None, "name": None, "seed": None})

    for round_index in round_indexes[:-1]:
        next_round_matches = matches_by_round[round_index + 1]
        for match in matches_by_round[round_index]:
            winner = playoff_slot_for_winner(match)
            next_match = next_round_matches[match.match_index // 2]
            set_playoff_match_slot(next_match, match.match_index % 2, winner)

        for next_match in next_round_matches:
            valid_winners = {next_match.player_one_profile_id, next_match.player_two_profile_id}
            if (
                next_match.player_one_profile_id is None
                or next_match.player_two_profile_id is None
                or next_match.winner_profile_id not in valid_winners
            ):
                next_match.winner_profile_id = None

    final_match = matches_by_round[round_indexes[-1]][0]
    bracket.status = "completed" if final_match.winner_profile_id is not None else "active"


def auto_publish_tournament_if_published(db: Session, tournament_id: int) -> None:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None or tournament.publish_status != "published" or not tournament.public_id:
        return

    try:
        snapshot = build_publish_payload(db, tournament)
        publish_snapshot(tournament.public_id, snapshot)
        publish_tournament(db, tournament)
    except (PublicPublishingConfigurationError, PublicPublishingRemoteError) as exc:
        db.rollback()
        logger.warning("Playoff change saved, but hosted public snapshot refresh failed for tournament %s: %s", tournament_id, exc)


def clear_downstream_playoff_winners(bracket: PlayoffBracket, changed_match: PlayoffMatch) -> None:
    matches_by_round: dict[int, list[PlayoffMatch]] = {}
    for match in bracket.matches:
        matches_by_round.setdefault(match.round_index, []).append(match)

    for round_matches in matches_by_round.values():
        round_matches.sort(key=lambda item: item.match_index)

    current_match = changed_match
    while current_match.round_index + 1 in matches_by_round:
        next_match = matches_by_round[current_match.round_index + 1][current_match.match_index // 2]
        next_match.winner_profile_id = None
        current_match = next_match


async def read_xml_upload(file: UploadFile) -> Element:
    contents = await file.read()
    try:
        return fromstring(contents)
    except (DefusedXmlException, ParseError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="KTS file must be valid XML") from exc


def parse_tournament_file(root: Element) -> dict:
    if xml_local_name(root.tag) != "Tournament":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="KTS XML root must be Tournament")

    tournament_players = direct_child(root, "TournamentPlayers")
    if tournament_players is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="KTS file does not contain TournamentPlayers")

    parsed_players: list[dict] = []
    standings_rows: list[dict] = []
    for tourn_player in direct_children(tournament_players, "TournPlayer"):
        player_id = nested_child_text(tourn_player, ("Player", "ID"))
        player_name = kts_player_name(tourn_player)
        if not player_id or not player_name or is_bye(player_id) or is_bye(player_name):
            continue

        rank = parse_optional_int(child_text(tourn_player, "Rank"), "player rank")
        raw_points = parse_optional_int(child_text(tourn_player, "Points"), "player points")
        visible_points = parse_optional_int(child_text(tourn_player, "Wins"), "player wins")
        parsed_players.append({"cossy_id": player_id, "name": player_name})

        if rank is not None and visible_points is not None:
            standings_rows.append(
                {
                    "rank": rank,
                    "full_name": player_name,
                    "short_name": player_name,
                    "cossy_id": player_id,
                    "points": visible_points,
                    "tiebreaker": str(raw_points) if raw_points is not None else None,
                }
            )

    parsed_matches: list[dict] = []
    round_numbers: set[int] = set()
    matches_element = direct_child(root, "Matches")
    if matches_element is not None:
        for tourn_match in direct_children(matches_element, "TournMatch"):
            round_number = parse_optional_int(child_text(tourn_match, "Round"), "match round")
            if round_number is None or round_number < 1:
                continue

            table_number = parse_optional_int(child_text(tourn_match, "Table"), "table number")
            match_players = direct_children(tourn_match, "Player")
            player_one_cossy_id = kts_match_player_id(match_players[0] if len(match_players) > 0 else None)
            player_two_cossy_id = kts_match_player_id(match_players[1] if len(match_players) > 1 else None)

            if is_bye(player_one_cossy_id):
                player_one_cossy_id = None
            if is_bye(player_two_cossy_id):
                player_two_cossy_id = None
            if not player_one_cossy_id and not player_two_cossy_id:
                continue

            notes = None
            if not player_one_cossy_id:
                player_one_cossy_id, player_two_cossy_id = player_two_cossy_id, None
                notes = BYE_NOTE
            elif not player_two_cossy_id:
                notes = BYE_NOTE

            winner_id = kts_match_player_id(direct_child(tourn_match, "Winner"))
            result_status = kts_result_status(
                child_text(tourn_match, "Status"),
                winner_id,
                player_one_cossy_id,
                player_two_cossy_id,
            )
            if notes == BYE_NOTE and result_status == "UNREPORTED":
                result_status = "PLAYER_ONE_WIN"

            round_numbers.add(round_number)
            parsed_matches.append(
                {
                    "round_number": round_number,
                    "table_number": table_number,
                    "player_one_cossy_id": player_one_cossy_id,
                    "player_two_cossy_id": player_two_cossy_id,
                    "result_status": result_status,
                    "notes": notes,
                }
            )

    current_round = parse_optional_int(child_text(root, "CurrentRound"), "current round")
    if current_round is not None and current_round > 0:
        round_numbers.add(current_round)

    return {
        "current_round": current_round if current_round and current_round > 0 else None,
        "players": parsed_players,
        "matches": parsed_matches,
        "round_numbers": sorted(round_numbers),
        "standings": sorted(standings_rows, key=lambda standing: int(standing["rank"])),
    }


def import_parsed_tournament_file(db: Session, tournament_id: int, parsed_file: dict) -> TournamentFileImportSummary:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    tournament.current_round_id = None
    db.flush()

    for match in list(db.scalars(select(Match).where(Match.tournament_id == tournament_id))):
        db.delete(match)
    for standing in list(db.scalars(select(Standing).where(Standing.tournament_id == tournament_id))):
        db.delete(standing)
    db.flush()
    for round_ in list(db.scalars(select(Round).where(Round.tournament_id == tournament_id))):
        db.delete(round_)
    for player in list(db.scalars(select(Player).where(Player.tournament_id == tournament_id))):
        db.delete(player)
    db.flush()

    players_by_cossy_id: dict[str, Player] = {}
    for parsed_player in parsed_file["players"]:
        profile = get_or_create_player_profile(db, parsed_player["name"], parsed_player["cossy_id"])
        player = Player(tournament_id=tournament_id, player_profile_id=profile.id, name=parsed_player["name"])
        db.add(player)
        db.flush()
        players_by_cossy_id[parsed_player["cossy_id"]] = player

    rounds_by_number: dict[int, Round] = {}
    for round_number in parsed_file["round_numbers"]:
        round_ = Round(tournament_id=tournament_id, number=round_number)
        db.add(round_)
        db.flush()
        rounds_by_number[round_number] = round_

    matches_imported = 0
    for parsed_match in parsed_file["matches"]:
        player_one = players_by_cossy_id.get(parsed_match["player_one_cossy_id"])
        if player_one is None:
            continue

        player_two = None
        if parsed_match["player_two_cossy_id"]:
            player_two = players_by_cossy_id.get(parsed_match["player_two_cossy_id"])
            if player_two is None:
                continue

        round_ = rounds_by_number.get(parsed_match["round_number"])
        if round_ is None:
            continue

        db.add(
            Match(
                tournament_id=tournament_id,
                round_id=round_.id,
                table_number=parsed_match["table_number"],
                player_one_id=player_one.id,
                player_two_id=player_two.id if player_two else None,
                result_status=parsed_match["result_status"],
                notes=parsed_match["notes"],
            )
        )
        matches_imported += 1

    standings_imported = 0
    for standing_row in parsed_file["standings"]:
        player = players_by_cossy_id.get(standing_row["cossy_id"])
        if player is None:
            continue

        db.add(Standing(tournament_id=tournament_id, player_profile_id=player.player_profile_id, **standing_row))
        standings_imported += 1

    current_round_number = parsed_file["current_round"]
    if current_round_number is not None and current_round_number in rounds_by_number:
        tournament.current_round_id = rounds_by_number[current_round_number].id

    db.commit()

    return TournamentFileImportSummary(
        players_imported=len(players_by_cossy_id),
        rounds_imported=len(rounds_by_number),
        matches_imported=matches_imported,
        standings_imported=standings_imported,
        current_round=current_round_number if tournament.current_round_id is not None else None,
    )


def delete_orphaned_player_profiles(db: Session, profile_ids: set[int]) -> None:
    for profile_id in profile_ids:
        has_tournament_player = db.scalar(select(Player.id).where(Player.player_profile_id == profile_id).limit(1))
        has_standing = db.scalar(select(Standing.id).where(Standing.player_profile_id == profile_id).limit(1))

        if has_tournament_player is None and has_standing is None:
            profile = db.get(PlayerProfile, profile_id)
            if profile is not None:
                db.delete(profile)


def parse_round_csv(csv_text: str) -> list[tuple[int, str, str | None, str | None]]:
    reader = csv.DictReader(StringIO(csv_text))
    required_columns = {"Table", "Player 1", "Player 2"}
    if reader.fieldnames is None or not required_columns.issubset(set(reader.fieldnames)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='CSV must include "Table", "Player 1", and "Player 2" columns',
        )

    imported_rows: list[tuple[int, str, str | None, str | None]] = []
    seen_tables: set[int] = set()
    seen_players: set[str] = set()

    for row_number, row in enumerate(reader, start=2):
        table_value = (row.get("Table") or "").strip()
        raw_player_one_name = row.get("Player 1") or ""
        raw_player_two_name = row.get("Player 2") or ""
        player_one_name = raw_player_one_name.strip()
        player_two_name = raw_player_two_name.strip()
        player_one_is_bye = is_bye(raw_player_one_name)
        player_two_is_bye = is_bye(raw_player_two_name)
        player_one_real_name = None if player_one_is_bye else player_one_name
        player_two_real_name = None if player_two_is_bye else player_two_name
        real_player_names = [
            player_name
            for player_name in (player_one_real_name, player_two_real_name)
            if player_name
        ]

        if not player_one_name and not player_two_name:
            continue

        if player_one_is_bye and player_two_is_bye:
            continue

        if not table_value or not real_player_names:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} must include a table number and at least one player",
            )

        try:
            table_number = int(table_value)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} has an invalid table number",
            ) from exc

        if table_number < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} table number must be 1 or greater",
            )

        if table_number in seen_tables:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Table {table_number} appears more than once in the CSV",
            )
        seen_tables.add(table_number)

        if len(real_player_names) == 2 and real_player_names[0] == real_player_names[1]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} matches a player against themselves",
            )

        for player_name in real_player_names:
            if player_name in seen_players:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{player_name} appears in more than one match in the CSV",
                )
            seen_players.add(player_name)

        if player_one_is_bye or player_two_is_bye:
            imported_rows.append((table_number, real_player_names[0], None, BYE_NOTE))
        elif player_one_real_name:
            imported_rows.append((table_number, player_one_real_name, player_two_real_name or None, None))
        else:
            imported_rows.append((table_number, real_player_names[0], None, None))

    if not imported_rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV does not contain any matches")

    return imported_rows


def parse_standings_csv(csv_text: str) -> list[dict[str, str | int | None]]:
    reader = csv.DictReader(StringIO(csv_text))
    required_columns = {"Rank", "Full Name", "Short Name", "COSSY ID", "Points", "Tiebreaker"}
    if reader.fieldnames is None or not required_columns.issubset(set(reader.fieldnames)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='CSV must include "Rank", "Full Name", "Short Name", "COSSY ID", "Points", and "Tiebreaker" columns',
        )

    standings_rows: list[dict[str, str | int | None]] = []
    for row_number, row in enumerate(reader, start=2):
        rank_value = (row.get("Rank") or "").strip()
        full_name = (row.get("Full Name") or "").strip()
        short_name = (row.get("Short Name") or "").strip()
        cossy_id = (row.get("COSSY ID") or "").strip()
        points_value = (row.get("Points") or "").strip()
        tiebreaker = (row.get("Tiebreaker") or "").strip()

        if not rank_value and not full_name and not short_name and not cossy_id and not points_value and not tiebreaker:
            continue

        if not rank_value or not full_name or not points_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} must include Rank, Full Name, and Points",
            )

        try:
            rank = int(rank_value)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} has an invalid rank",
            ) from exc

        try:
            points = int(points_value)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Row {row_number} has invalid points",
            ) from exc

        standings_rows.append(
            {
                "rank": rank,
                "full_name": full_name,
                "short_name": short_name or None,
                "cossy_id": cossy_id or None,
                "points": points,
                "tiebreaker": tiebreaker or None,
            }
        )

    if not standings_rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV does not contain any standings")

    return sorted(standings_rows, key=lambda standing: int(standing["rank"]))


async def read_csv_upload(file: UploadFile) -> str:
    contents = await file.read()
    try:
        return contents.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file must be UTF-8 encoded") from exc


@router.post("", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(tournament_data: TournamentCreate, db: Session = Depends(get_db)) -> Tournament:
    tournament = Tournament(**tournament_data.model_dump())
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    return tournament


@router.post("/import", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def import_tournament_backup(
    backup: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
) -> Tournament:
    return import_tournament_backup_payload(db, backup)


@router.get("/{tournament_id}", response_model=TournamentRead)
def get_tournament(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


@router.get("/{tournament_id}/export")
def export_tournament_backup(tournament_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return build_tournament_backup(db, tournament)


@router.get("", response_model=list[TournamentRead])
def list_tournaments(db: Session = Depends(get_db)) -> list[Tournament]:
    return list(db.scalars(select(Tournament).order_by(Tournament.id)))


@router.delete("/{tournament_id}")
def delete_tournament(tournament_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    from app.kts_watcher import kts_auto_sync_service

    if kts_auto_sync_service.status().get("tournament_id") == tournament_id:
        kts_auto_sync_service.disable()

    profile_ids = {
        profile_id
        for profile_id in db.scalars(select(Player.player_profile_id).where(Player.tournament_id == tournament_id))
        if profile_id is not None
    }
    profile_ids.update(
        profile_id
        for profile_id in db.scalars(select(Standing.player_profile_id).where(Standing.tournament_id == tournament_id))
        if profile_id is not None
    )

    tournament.current_round_id = None
    db.flush()

    for playoff_bracket in list(db.scalars(select(PlayoffBracket).where(PlayoffBracket.tournament_id == tournament_id))):
        db.delete(playoff_bracket)
    db.flush()

    for match in list(db.scalars(select(Match).where(Match.tournament_id == tournament_id))):
        db.delete(match)
    for standing in list(db.scalars(select(Standing).where(Standing.tournament_id == tournament_id))):
        db.delete(standing)
    db.flush()

    for round_ in list(db.scalars(select(Round).where(Round.tournament_id == tournament_id))):
        db.delete(round_)
    for player in list(db.scalars(select(Player).where(Player.tournament_id == tournament_id))):
        db.delete(player)
    db.flush()

    db.delete(tournament)
    db.flush()
    delete_orphaned_player_profiles(db, profile_ids)
    db.commit()

    return {"deleted": True}


@router.get("/{tournament_id}/standings", response_model=list[StandingRead])
def list_tournament_standings(tournament_id: int, db: Session = Depends(get_db)) -> list[Standing]:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    statement = select(Standing).where(Standing.tournament_id == tournament_id).order_by(Standing.rank)
    return list(db.scalars(statement))


@router.get("/{tournament_id}/playoffs", response_model=PlayoffBracketRead | None)
def get_playoffs(tournament_id: int, db: Session = Depends(get_db)) -> PlayoffBracketRead | None:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    bracket = get_tournament_playoff_bracket(db, tournament_id)
    return playoff_bracket_read(bracket) if bracket is not None else None


@router.post("/{tournament_id}/playoffs", response_model=PlayoffBracketRead, status_code=status.HTTP_201_CREATED)
def create_playoffs(
    tournament_id: int,
    playoff_data: PlayoffCreate,
    db: Session = Depends(get_db),
) -> PlayoffBracketRead:
    validate_playoff_size(playoff_data.size)

    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if get_tournament_playoff_bracket(db, tournament_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This tournament already has a playoff bracket. Delete it before creating another.",
        )

    standings = list(
        db.scalars(
            select(Standing)
            .where(Standing.tournament_id == tournament_id)
            .order_by(Standing.rank)
        )
    )
    if len(standings) < playoff_data.size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Top {playoff_data.size} requires at least {playoff_data.size} standings players.",
        )

    seeded_players = {
        seed: standing
        for seed, standing in enumerate(standings[: playoff_data.size], start=1)
    }
    if any(standing.player_profile_id is None for standing in seeded_players.values()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Every seeded standings player must have a player profile before creating playoffs.",
        )

    bracket = PlayoffBracket(tournament_id=tournament_id, size=playoff_data.size)
    db.add(bracket)
    db.flush()

    for match_index, (player_one_seed, player_two_seed) in enumerate(protected_playoff_seed_pairings(playoff_data.size)):
        player_one = seeded_players[player_one_seed]
        player_two = seeded_players[player_two_seed]
        db.add(
            PlayoffMatch(
                bracket_id=bracket.id,
                round_index=0,
                match_index=match_index,
                player_one_profile_id=player_one.player_profile_id,
                player_two_profile_id=player_two.player_profile_id,
                player_one_name=player_one.short_name or player_one.full_name,
                player_two_name=player_two.short_name or player_two.full_name,
                player_one_seed=player_one_seed,
                player_two_seed=player_two_seed,
            )
        )

    round_index = 1
    match_count = playoff_data.size // 4
    while match_count >= 1:
        for match_index in range(match_count):
            db.add(PlayoffMatch(bracket_id=bracket.id, round_index=round_index, match_index=match_index))
        round_index += 1
        match_count //= 2

    db.commit()
    db.refresh(bracket)
    bracket_read = playoff_bracket_read(bracket)
    auto_publish_tournament_if_published(db, tournament_id)
    return bracket_read


@router.put("/{tournament_id}/playoffs/matches/{match_id}/winner", response_model=PlayoffBracketRead)
def update_playoff_winner(
    tournament_id: int,
    match_id: int,
    winner_data: PlayoffWinnerUpdate,
    db: Session = Depends(get_db),
) -> PlayoffBracketRead:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    bracket = get_tournament_playoff_bracket(db, tournament_id)
    if bracket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playoff bracket not found")

    match = next((item for item in bracket.matches if item.id == match_id), None)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playoff match not found")

    if match.player_one_profile_id is None or match.player_two_profile_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both playoff match players must be known first.")

    valid_winner_ids = {match.player_one_profile_id, match.player_two_profile_id}
    if winner_data.winner_player_id not in valid_winner_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Winner must be one of this playoff match's players.")

    previous_winner_id = match.winner_profile_id
    match.winner_profile_id = winner_data.winner_player_id
    if previous_winner_id is not None and previous_winner_id != winner_data.winner_player_id:
        clear_downstream_playoff_winners(bracket, match)
    recompute_playoff_advancement(bracket)
    db.commit()
    db.refresh(bracket)
    bracket_read = playoff_bracket_read(bracket)
    auto_publish_tournament_if_published(db, tournament_id)
    return bracket_read


@router.delete("/{tournament_id}/playoffs")
def delete_playoffs(tournament_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    bracket = get_tournament_playoff_bracket(db, tournament_id)
    if bracket is not None:
        db.delete(bracket)
        db.commit()
        auto_publish_tournament_if_published(db, tournament_id)

    return {"deleted": True}


@router.get("/{tournament_id}/public-snapshot", response_model=PublicTournamentSnapshotRead)
def get_public_tournament_snapshot(tournament_id: int, db: Session = Depends(get_db)) -> PublicTournamentSnapshotRead:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return build_public_tournament_snapshot(db, tournament)


@router.get("/{tournament_id}/publish-status", response_model=TournamentPublishStatusRead)
def get_tournament_publish_status(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


@router.get("/public-publishing/config", response_model=PublicPublishingConfigRead)
def get_public_publishing_configuration() -> PublicPublishingConfigRead:
    config = get_public_publishing_config()
    return PublicPublishingConfigRead(
        configured=config.is_configured,
        service_url=config.service_url,
        site_url=config.site_url,
        publish_key_configured=bool(config.publish_key),
    )


@router.post("/{tournament_id}/publish", response_model=TournamentPublishStatusRead)
def publish_tournament_route(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    try:
        public_id = ensure_public_id(db, tournament)
        snapshot = build_publish_payload(db, tournament)
        publish_snapshot(public_id, snapshot)
        return publish_tournament(db, tournament)
    except PublicPublishingConfigurationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except PublicPublishingRemoteError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/{tournament_id}/unpublish", response_model=TournamentPublishStatusRead)
def unpublish_tournament_route(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if not tournament.public_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tournament has not been published yet")

    try:
        unpublish_snapshot(tournament.public_id)
        return unpublish_tournament(db, tournament)
    except PublicPublishingConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except PublicPublishingRemoteError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.patch("/{tournament_id}/current-round", response_model=TournamentRead)
def update_current_round(
    tournament_id: int,
    current_round_data: TournamentCurrentRoundUpdate,
    db: Session = Depends(get_db),
) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    round_ = db.get(Round, current_round_data.round_id)
    if round_ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

    if round_.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Round does not belong to tournament")

    tournament.current_round_id = round_.id
    db.commit()
    db.refresh(tournament)
    return tournament


@router.patch("/{tournament_id}/community-stats", response_model=TournamentRead)
def update_community_stats_inclusion(
    tournament_id: int,
    community_stats_data: TournamentCommunityStatsUpdate,
    db: Session = Depends(get_db),
) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    tournament.counts_toward_community_stats = community_stats_data.counts_toward_community_stats
    db.commit()
    db.refresh(tournament)
    return tournament


@router.post("/{tournament_id}/preview-round-csv", response_model=RoundCsvPreviewSummary)
async def preview_round_csv(
    tournament_id: int,
    round_number: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> RoundCsvPreviewSummary:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if round_number < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Round number must be 1 or greater")

    imported_rows = parse_round_csv(await read_csv_upload(file))
    detected_players = {
        player_name
        for _, player_one_name, player_two_name, _ in imported_rows
        for player_name in (player_one_name, player_two_name)
        if player_name
    }
    tables = [table_number for table_number, _, _, _ in imported_rows]
    bye_count = sum(1 for _, _, _, notes in imported_rows if notes == BYE_NOTE)

    warning = None
    round_ = db.scalar(
        select(Round).where(
            Round.tournament_id == tournament_id,
            Round.number == round_number,
        )
    )
    if round_ is not None:
        existing_match = db.scalar(select(Match).where(Match.round_id == round_.id))
        if existing_match is not None:
            warning = f"This will replace existing matches for Round {round_number}."

    return RoundCsvPreviewSummary(
        round_number=round_number,
        matches_count=len(imported_rows),
        players_detected_count=len(detected_players),
        bye_count=bye_count,
        tables=tables,
        warning=warning,
    )


@router.post("/{tournament_id}/import-round-csv", response_model=RoundCsvImportSummary)
async def import_round_csv(
    tournament_id: int,
    round_number: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> RoundCsvImportSummary:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if round_number < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Round number must be 1 or greater")

    imported_rows = parse_round_csv(await read_csv_upload(file))

    round_ = db.scalar(
        select(Round).where(
            Round.tournament_id == tournament_id,
            Round.number == round_number,
        )
    )
    if round_ is None:
        round_ = Round(tournament_id=tournament_id, number=round_number)
        db.add(round_)
        db.flush()

    existing_matches = list(db.scalars(select(Match).where(Match.round_id == round_.id)))
    for match in existing_matches:
        db.delete(match)
    db.flush()

    bye_players = list(db.scalars(select(Player).where(Player.tournament_id == tournament_id)))
    for player in bye_players:
        if is_bye(player.name):
            db.delete(player)
    db.flush()

    players_by_name = {
        player.name: player
        for player in db.scalars(select(Player).where(Player.tournament_id == tournament_id))
        if not is_bye(player.name)
    }
    players_created = 0

    def get_or_create_player(player_name: str) -> Player:
        nonlocal players_created
        if is_bye(player_name):
            raise RuntimeError("BYE values must not be stored as players")

        player = players_by_name.get(player_name)
        if player is not None:
            if player.player_profile_id is None:
                profile = get_or_create_player_profile(db, player_name)
                player.player_profile_id = profile.id
                db.flush()
            return player

        profile = get_or_create_player_profile(db, player_name)
        player = Player(tournament_id=tournament_id, player_profile_id=profile.id, name=player_name)
        db.add(player)
        db.flush()
        players_by_name[player.name] = player
        players_created += 1
        return player

    for table_number, player_one_name, player_two_name, notes in imported_rows:
        player_one = get_or_create_player(player_one_name)
        player_two = None
        if player_two_name and not is_bye(player_two_name):
            player_two = get_or_create_player(player_two_name)

        db.add(
            Match(
                tournament_id=tournament_id,
                round_id=round_.id,
                table_number=table_number,
                player_one_id=player_one.id,
                player_two_id=player_two.id if player_two else None,
                result_status="PLAYER_ONE_WIN" if notes == BYE_NOTE else "UNREPORTED",
                notes=notes,
            )
        )

    tournament.current_round_id = round_.id
    db.commit()

    return RoundCsvImportSummary(
        round_number=round_number,
        matches_imported=len(imported_rows),
        players_created=players_created,
    )


@router.post("/{tournament_id}/import-standings-csv", response_model=StandingsCsvImportSummary)
async def import_standings_csv(
    tournament_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> StandingsCsvImportSummary:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    standings_rows = parse_standings_csv(await read_csv_upload(file))

    existing_standings = list(db.scalars(select(Standing).where(Standing.tournament_id == tournament_id)))
    for standing in existing_standings:
        db.delete(standing)
    db.flush()

    players_by_name = {
        player.name: player
        for player in db.scalars(select(Player).where(Player.tournament_id == tournament_id))
        if not is_bye(player.name)
    }

    for row in standings_rows:
        display_name = str(row["full_name"])
        profile = get_or_create_player_profile(db, display_name, str(row["cossy_id"]) if row["cossy_id"] else None)

        tournament_player = players_by_name.get(str(row["full_name"])) or players_by_name.get(display_name)
        if tournament_player is not None and tournament_player.player_profile_id is None:
            tournament_player.player_profile_id = profile.id

        db.add(Standing(tournament_id=tournament_id, player_profile_id=profile.id, **row))

    db.commit()

    top_player = standings_rows[0]
    return StandingsCsvImportSummary(
        players_imported=len(standings_rows),
        top_player_name=str(top_player["short_name"] or top_player["full_name"]),
        top_player_points=int(top_player["points"]),
    )


@router.post("/{tournament_id}/import-tournament-file", response_model=TournamentFileImportSummary)
async def import_tournament_file(
    tournament_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> TournamentFileImportSummary:
    parsed_file = parse_tournament_file(await read_xml_upload(file))
    return import_parsed_tournament_file(db, tournament_id, parsed_file)
