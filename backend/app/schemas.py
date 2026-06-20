from datetime import datetime
from typing import Literal

from pydantic import BaseModel

MatchResultStatus = Literal["PLAYER_ONE_WIN", "PLAYER_TWO_WIN", "DRAW", "DOUBLE_LOSS", "UNREPORTED"]
PublishStatus = Literal["draft", "published", "unpublished"]


class HealthCheck(BaseModel):
    status: str


class AutoSyncStatusRead(BaseModel):
    enabled: bool
    tournament_id: int | None
    tournament_name: str | None
    file_path: str | None
    file_name: str | None
    file_exists: bool
    last_sync_at: datetime | None
    last_status: str | None
    last_error: str | None


class AutoSyncEnableRequest(BaseModel):
    tournament_id: int
    file_path: str


class TournamentCreate(BaseModel):
    name: str
    location: str | None = None


class TournamentRead(BaseModel):
    id: int
    name: str
    location: str | None
    current_round_id: int | None
    kts_file_path: str | None
    publish_status: PublishStatus
    public_id: str | None
    public_url: str | None
    published_at: datetime | None
    last_published_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PublicTournamentSummaryRead(BaseModel):
    id: int
    name: str
    location: str | None
    current_round_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TournamentCurrentRoundUpdate(BaseModel):
    round_id: int


class TournamentPublishStatusRead(BaseModel):
    publish_status: PublishStatus
    public_id: str | None
    public_url: str | None
    published_at: datetime | None
    last_published_at: datetime | None

    model_config = {"from_attributes": True}


class PublicPublishingConfigRead(BaseModel):
    configured: bool
    service_url: str | None


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


class AutoSyncRunNowResponse(BaseModel):
    summary: TournamentFileImportSummary
    status: AutoSyncStatusRead


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
    player_profile_id: int | None
    name: str
    cossy_id: str | None

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
    player_profile_id: int | None
    rank: int
    full_name: str
    short_name: str | None
    cossy_id: str | None
    points: int
    tiebreaker: str | None

    model_config = {"from_attributes": True}


class PlayerProfileRead(BaseModel):
    id: int
    display_name: str
    cossy_id: str | None
    normalized_name: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlayerProfileSummaryRead(BaseModel):
    id: int
    display_name: str
    cossy_id: str | None
    tournaments_played: int
    total_points: int
    average_points: float
    best_rank: int | None
    last_tournament_date: datetime | None


class PlayerTournamentHistoryRead(BaseModel):
    tournament_id: int
    tournament_name: str
    tournament_date: datetime
    rank: int
    points: int
    tiebreaker: str | None


class PlayerProfileDetailRead(BaseModel):
    profile: PlayerProfileRead
    tournaments_played: int
    total_points: int
    average_points: float
    best_rank: int | None
    last_tournament_date: datetime | None
    tournament_history: list[PlayerTournamentHistoryRead]


class PublicStandingRead(BaseModel):
    id: int
    tournament_id: int
    rank: int
    full_name: str
    short_name: str | None
    cossy_id: str | None
    points: int

    model_config = {"from_attributes": True}


class PublicTournamentRead(BaseModel):
    tournament: PublicTournamentSummaryRead
    players: list[PlayerRead]
    rounds: list[RoundRead]
    matches: list[PublicMatchRead]
    standings: list[PublicStandingRead]


class PublicSnapshotPairingRead(BaseModel):
    table_number: int | None
    player_one_name: str
    player_two_name: str | None
    result_status: MatchResultStatus
    notes: str | None


class PublicSnapshotStandingRead(BaseModel):
    rank: int
    player_name: str
    points: int
    tiebreaker: str | None


class PublicSnapshotMetadataRead(BaseModel):
    total_players: int
    total_rounds: int
    unreported_match_count: int


class PublicTournamentSnapshotRead(BaseModel):
    tournament_id: int
    tournament_name: str
    location: str | None
    current_round_number: int | None
    current_round_name: str | None
    last_updated_at: datetime
    public_display_status: str | None
    current_round_pairings: list[PublicSnapshotPairingRead]
    standings: list[PublicSnapshotStandingRead]
    metadata: PublicSnapshotMetadataRead
