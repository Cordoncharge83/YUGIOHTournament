import csv
from io import StringIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Player, Round, Tournament
from app.schemas import (
    RoundCsvImportSummary,
    RoundCsvPreviewSummary,
    TournamentCreate,
    TournamentCurrentRoundUpdate,
    TournamentRead,
)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])
KTS_BYE_VALUE = "***BYE***"
BYE_NOTE = "BYE"


def is_bye(value: str | None) -> bool:
    normalized_value = (value or "").strip().casefold().replace(" ", "")
    return normalized_value == KTS_BYE_VALUE.casefold()


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
            return player

        player = Player(tournament_id=tournament_id, name=player_name)
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
