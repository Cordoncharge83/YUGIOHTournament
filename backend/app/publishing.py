import re
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Tournament
from app.public_publishing_client import public_snapshot_url
from app.public_snapshots import build_public_tournament_snapshot


def public_id_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug[:48].strip("-") or "tournament"


def generate_public_id(db: Session, tournament_name: str) -> str:
    slug = public_id_slug(tournament_name)

    while True:
        candidate = f"{slug}-{secrets.token_hex(4)}"
        existing_id = db.scalar(select(Tournament.id).where(Tournament.public_id == candidate))
        if existing_id is None:
            return candidate


def publish_tournament(db: Session, tournament: Tournament) -> Tournament:
    now = datetime.now(timezone.utc)

    if not tournament.public_id:
        tournament.public_id = generate_public_id(db, tournament.name)

    tournament.publish_status = "published"
    tournament.public_url = public_snapshot_url(tournament.public_id)
    if tournament.published_at is None:
        tournament.published_at = now
    tournament.last_published_at = now
    db.commit()
    db.refresh(tournament)
    return tournament


def unpublish_tournament(db: Session, tournament: Tournament) -> Tournament:
    tournament.publish_status = "unpublished"
    db.commit()
    db.refresh(tournament)
    return tournament


def ensure_public_id(db: Session, tournament: Tournament) -> str:
    if not tournament.public_id:
        tournament.public_id = generate_public_id(db, tournament.name)
        db.flush()

    return tournament.public_id


def build_publish_payload(db: Session, tournament: Tournament) -> dict:
    snapshot = build_public_tournament_snapshot(db, tournament).model_dump(mode="json")
    snapshot.pop("tournament_id", None)
    snapshot["public_display_status"] = "published"
    return snapshot
