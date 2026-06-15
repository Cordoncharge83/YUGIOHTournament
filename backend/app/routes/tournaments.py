import csv
from io import StringIO
from xml.etree.ElementTree import Element, ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Player, PlayerProfile, Round, Standing, Tournament
from app.player_profiles import get_or_create_player_profile
from app.schemas import (
    RoundCsvImportSummary,
    RoundCsvPreviewSummary,
    StandingRead,
    StandingsCsvImportSummary,
    TournamentCreate,
    TournamentCurrentRoundUpdate,
    TournamentFileImportSummary,
    TournamentRead,
)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])
KTS_BYE_VALUE = "***BYE***"
BYE_NOTE = "BYE"


def is_bye(value: str | None) -> bool:
    normalized_value = (value or "").strip().casefold().replace(" ", "")
    return normalized_value == KTS_BYE_VALUE.casefold()


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


@router.get("/{tournament_id}", response_model=TournamentRead)
def get_tournament(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


@router.get("", response_model=list[TournamentRead])
def list_tournaments(db: Session = Depends(get_db)) -> list[Tournament]:
    return list(db.scalars(select(Tournament).order_by(Tournament.id)))


@router.delete("/{tournament_id}")
def delete_tournament(tournament_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

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
