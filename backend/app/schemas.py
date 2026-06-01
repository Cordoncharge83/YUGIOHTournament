from datetime import datetime
from typing import Literal

from pydantic import BaseModel

MatchResultStatus = Literal["PLAYER_ONE_WIN", "PLAYER_TWO_WIN", "DRAW", "DOUBLE_LOSS", "UNREPORTED"]


class HealthCheck(BaseModel):
    status: str


class TournamentCreate(BaseModel):
    name: str
    location: str | None = None


class TournamentRead(BaseModel):
    id: int
    name: str
    location: str | None
    current_round_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TournamentCurrentRoundUpdate(BaseModel):
    round_id: int


class RoundCsvImportSummary(BaseModel):
    round_number: int
    matches_imported: int
    players_created: int


class StandingsCsvImportSummary(BaseModel):
    players_imported: int
    top_player_name: str | None
    top_player_points: int | None


class TournamentFileImportSummary(BaseModel):
    players_imported: int
    rounds_imported: int
    matches_imported: int
    standings_imported: int
    current_round: int | None


class RoundCsvPreviewSummary(BaseModel):
    round_number: int
    matches_count: int
    players_detected_count: int
    bye_count: int
    tables: list[int]
    warning: str | None


class PlayerCreate(BaseModel):
    name: str


class PlayerRead(BaseModel):
    id: int
    tournament_id: int
    name: str

    model_config = {"from_attributes": True}


class RoundCreate(BaseModel):
    number: int


class RoundRead(BaseModel):
    id: int
    tournament_id: int
    number: int

    model_config = {"from_attributes": True}


class MatchCreate(BaseModel):
    round_id: int
    table_number: int
    player_one_id: int
    player_two_id: int


class MatchRead(BaseModel):
    id: int
    tournament_id: int
    round_id: int
    table_number: int | None
    player_one_id: int
    player_two_id: int | None
    player_one_score: int | None
    player_two_score: int | None
    result_status: MatchResultStatus
    notes: str | None

    model_config = {"from_attributes": True}


class MatchResultUpdate(BaseModel):
    result_status: MatchResultStatus


class PublicMatchRead(BaseModel):
    table_number: int | None
    round_number: int
    player_one_name: str
    player_two_name: str | None
    player_one_score: int | None
    player_two_score: int | None
    result_status: MatchResultStatus
    notes: str | None


class StandingRead(BaseModel):
    id: int
    tournament_id: int
    rank: int
    full_name: str
    short_name: str | None
    cossy_id: str | None
    points: int
    tiebreaker: str | None

    model_config = {"from_attributes": True}


class PublicStandingRead(BaseModel):
    id: int
    tournament_id: int
    rank: int
    full_name: str
    short_name: str | None
    points: int

    model_config = {"from_attributes": True}


class PublicTournamentRead(BaseModel):
    tournament: TournamentRead
    players: list[PlayerRead]
    rounds: list[RoundRead]
    matches: list[PublicMatchRead]
    standings: list[PublicStandingRead]
