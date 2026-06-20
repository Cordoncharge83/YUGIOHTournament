import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, status

from app.local_settings import save_publishing_settings
from app.public_publishing_client import PUBLISH_TIMEOUT_SECONDS, PUBLISH_USER_AGENT, get_public_publishing_config
from app.schemas import PublishingSettingsRead, PublishingSettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/publishing", response_model=PublishingSettingsRead)
def get_publishing_settings() -> PublishingSettingsRead:
    return serialize_publishing_settings()


@router.put("/publishing", response_model=PublishingSettingsRead)
def update_publishing_settings(settings_update: PublishingSettingsUpdate) -> PublishingSettingsRead:
    if not settings_update.service_url.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Publishing API URL is required.")
    if not settings_update.site_url.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Public Page URL is required.")

    save_publishing_settings(
        service_url=settings_update.service_url,
        site_url=settings_update.site_url,
        publish_key=settings_update.publish_key,
    )
    return serialize_publishing_settings()


@router.post("/publishing/test")
def test_publishing_settings() -> dict[str, bool | str]:
    config = get_public_publishing_config()
    if not config.service_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Publishing API URL is required.")

    request = Request(
        f"{config.service_url}/api/health",
        headers={
            "Accept": "application/json",
            "User-Agent": PUBLISH_USER_AGENT,
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=PUBLISH_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Publishing API returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not reach Publishing API: {exc}") from exc

    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Publishing API returned invalid JSON.") from exc

    if payload.get("status") != "ok":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Publishing API health check did not return ok.")

    return {"ok": True, "message": "Publishing API is reachable."}


def serialize_publishing_settings() -> PublishingSettingsRead:
    config = get_public_publishing_config()
    return PublishingSettingsRead(
        configured=config.is_configured,
        service_url=config.service_url,
        site_url=config.site_url,
        publish_key_configured=bool(config.publish_key),
    )
