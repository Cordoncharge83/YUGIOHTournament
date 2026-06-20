import json
import os
from pathlib import Path
from typing import Any

from app.database import APP_DATA_PATH

DEFAULT_PUBLIC_SERVICE_URL = "https://yugioh-tournament-public-service.mouadh-bondka-2.workers.dev"
DEFAULT_PUBLIC_SITE_URL = "https://ygotourn.pages.dev"
SETTINGS_FILE_NAME = "settings.json"
PUBLISHING_SECTION = "publishing"


def settings_path() -> Path:
    if APP_DATA_PATH:
        return APP_DATA_PATH / SETTINGS_FILE_NAME

    return Path(SETTINGS_FILE_NAME)


def read_settings() -> dict[str, Any]:
    path = settings_path()
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    return data if isinstance(data, dict) else {}


def write_settings(settings: dict[str, Any]) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(settings, indent=2, sort_keys=True)}\n", encoding="utf-8")


def read_publishing_settings() -> dict[str, str | None]:
    settings = read_settings()
    publishing = settings.get(PUBLISHING_SECTION)
    if not isinstance(publishing, dict):
        publishing = {}

    return {
        "service_url": normalize_url(publishing.get("service_url")) or normalize_url(os.getenv("PUBLIC_SERVICE_URL")) or DEFAULT_PUBLIC_SERVICE_URL,
        "site_url": normalize_url(publishing.get("site_url")) or normalize_url(os.getenv("PUBLIC_SITE_URL")) or DEFAULT_PUBLIC_SITE_URL,
        "publish_key": normalize_secret(publishing.get("publish_key")) or normalize_secret(os.getenv("PUBLIC_PUBLISH_KEY")),
    }


def save_publishing_settings(service_url: str, site_url: str, publish_key: str | None) -> dict[str, str | None]:
    settings = read_settings()
    publishing = settings.get(PUBLISHING_SECTION)
    if not isinstance(publishing, dict):
        publishing = {}

    publishing["service_url"] = normalize_url(service_url)
    publishing["site_url"] = normalize_url(site_url)

    normalized_publish_key = normalize_secret(publish_key)
    if normalized_publish_key:
        publishing["publish_key"] = normalized_publish_key

    settings[PUBLISHING_SECTION] = publishing
    write_settings(settings)
    return read_publishing_settings()


def normalize_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip().rstrip("/")
    return normalized or None


def normalize_secret(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    return normalized or None
