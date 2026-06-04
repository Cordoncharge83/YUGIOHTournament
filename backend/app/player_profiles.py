from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PlayerProfile


def normalize_player_name(name: str) -> str:
    return " ".join(name.casefold().strip().split())


def normalize_cossy_id(cossy_id: str | None) -> str | None:
    normalized = (cossy_id or "").strip()
    return normalized or None


def get_or_create_player_profile(
    db: Session,
    display_name: str,
    cossy_id: str | None = None,
) -> PlayerProfile:
    normalized_cossy_id = normalize_cossy_id(cossy_id)
    normalized_name = normalize_player_name(display_name)

    if normalized_cossy_id:
        profile = db.scalar(select(PlayerProfile).where(PlayerProfile.cossy_id == normalized_cossy_id))
        if profile is not None:
            if profile.display_name != display_name:
                profile.display_name = display_name
            return profile

    profile = db.scalar(select(PlayerProfile).where(PlayerProfile.normalized_name == normalized_name))
    if profile is not None:
        if normalized_cossy_id and profile.cossy_id and profile.cossy_id != normalized_cossy_id:
            profile = None
        else:
            if normalized_cossy_id and profile.cossy_id is None:
                profile.cossy_id = normalized_cossy_id
            if profile.display_name != display_name:
                profile.display_name = display_name
            return profile

    profile = PlayerProfile(
        cossy_id=normalized_cossy_id,
        display_name=display_name,
        normalized_name=normalized_name,
    )
    db.add(profile)
    db.flush()
    return profile
