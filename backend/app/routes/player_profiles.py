from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Player, PlayerProfile, Standing, Tournament
from app.schemas import (
    PlayerProfileDetailRead,
    PlayerProfileRead,
    PlayerProfileSummaryRead,
    PlayerTournamentHistoryRead,
)

router = APIRouter(prefix="/player-profiles", tags=["player-profiles"])


def build_profile_summary(db: Session, profile: PlayerProfile) -> PlayerProfileSummaryRead:
    tournaments_played = db.scalar(
        select(func.count(distinct(Player.tournament_id)))
        .join(Tournament, Tournament.id == Player.tournament_id)
        .where(Player.player_profile_id == profile.id)
        .where(Tournament.counts_toward_community_stats.is_(True))
    ) or 0
    total_points = db.scalar(
        select(func.coalesce(func.sum(Standing.points), 0))
        .join(Tournament, Tournament.id == Standing.tournament_id)
        .where(Standing.player_profile_id == profile.id)
        .where(Tournament.counts_toward_community_stats.is_(True))
    ) or 0
    best_rank = db.scalar(
        select(func.min(Standing.rank))
        .join(Tournament, Tournament.id == Standing.tournament_id)
        .where(Standing.player_profile_id == profile.id)
        .where(Tournament.counts_toward_community_stats.is_(True))
    )
    last_tournament_date = db.scalar(
        select(func.max(Tournament.created_at))
        .join(Player, Player.tournament_id == Tournament.id)
        .where(Player.player_profile_id == profile.id)
        .where(Tournament.counts_toward_community_stats.is_(True))
    )
    average_points = float(total_points) / tournaments_played if tournaments_played else 0.0

    return PlayerProfileSummaryRead(
        id=profile.id,
        display_name=profile.display_name,
        cossy_id=profile.cossy_id,
        tournaments_played=tournaments_played,
        total_points=total_points,
        average_points=average_points,
        best_rank=best_rank,
        last_tournament_date=last_tournament_date,
    )


@router.get("", response_model=list[PlayerProfileSummaryRead])
def list_player_profiles(db: Session = Depends(get_db)) -> list[PlayerProfileSummaryRead]:
    profiles = list(db.scalars(select(PlayerProfile).order_by(PlayerProfile.display_name, PlayerProfile.id)))
    return [build_profile_summary(db, profile) for profile in profiles]


@router.get("/{profile_id}", response_model=PlayerProfileDetailRead)
def get_player_profile(profile_id: int, db: Session = Depends(get_db)) -> PlayerProfileDetailRead:
    profile = db.get(PlayerProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player profile not found")

    summary = build_profile_summary(db, profile)
    history_rows = db.execute(
        select(
            Tournament.id,
            Tournament.name,
            Tournament.created_at,
            Standing.rank,
            Standing.points,
            Standing.tiebreaker,
        )
        .join(Standing, Standing.tournament_id == Tournament.id)
        .where(Standing.player_profile_id == profile.id)
        .where(Tournament.counts_toward_community_stats.is_(True))
        .order_by(Tournament.created_at.desc(), Tournament.id.desc())
    ).all()
    tournament_history = [
        PlayerTournamentHistoryRead(
            tournament_id=tournament_id,
            tournament_name=tournament_name,
            tournament_date=tournament_date,
            rank=rank,
            points=points,
            tiebreaker=tiebreaker,
        )
        for tournament_id, tournament_name, tournament_date, rank, points, tiebreaker in history_rows
    ]

    return PlayerProfileDetailRead(
        profile=PlayerProfileRead.model_validate(profile),
        tournaments_played=summary.tournaments_played,
        total_points=summary.total_points,
        average_points=summary.average_points,
        best_rank=summary.best_rank,
        last_tournament_date=summary.last_tournament_date,
        tournament_history=tournament_history,
    )
