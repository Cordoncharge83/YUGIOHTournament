import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


PUBLISH_TIMEOUT_SECONDS = 15
PUBLISH_USER_AGENT = "YuGiOhTournamentManager/1.0"
MAX_ERROR_DETAIL_LENGTH = 300


class PublicPublishingConfigurationError(RuntimeError):
    pass


class PublicPublishingRemoteError(RuntimeError):
    pass


@dataclass(frozen=True)
class PublicPublishingConfig:
    service_url: str | None
    site_url: str | None
    publish_key: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.service_url and self.site_url and self.publish_key)


def get_public_publishing_config() -> PublicPublishingConfig:
    return PublicPublishingConfig(
        service_url=normalize_service_url(os.getenv("PUBLIC_SERVICE_URL")),
        site_url=normalize_service_url(os.getenv("PUBLIC_SITE_URL")),
        publish_key=os.getenv("PUBLIC_PUBLISH_KEY") or None,
    )


def normalize_service_url(service_url: str | None) -> str | None:
    if not service_url:
        return None

    normalized_url = service_url.strip().rstrip("/")
    return normalized_url or None


def public_snapshot_url(public_id: str, config: PublicPublishingConfig | None = None) -> str:
    active_config = config or get_public_publishing_config()
    if not active_config.service_url:
        raise PublicPublishingConfigurationError("PUBLIC_SERVICE_URL is not configured.")

    return f"{active_config.service_url}/api/tournaments/{quote(public_id, safe='')}"


def public_site_tournament_url(public_id: str, config: PublicPublishingConfig | None = None) -> str:
    active_config = config or get_public_publishing_config()
    if not active_config.site_url:
        raise PublicPublishingConfigurationError("PUBLIC_SITE_URL is not configured.")

    return f"{active_config.site_url}/tournaments/{quote(public_id, safe='')}"


def publish_snapshot(public_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    config = require_public_publishing_config()
    return send_json_request(
        method="PUT",
        url=public_snapshot_url(public_id, config),
        publish_key=config.publish_key,
        body=snapshot,
    )


def unpublish_snapshot(public_id: str) -> dict[str, Any]:
    config = require_public_publishing_config()
    return send_json_request(
        method="POST",
        url=f"{public_snapshot_url(public_id, config)}/unpublish",
        publish_key=config.publish_key,
    )


def require_public_publishing_config() -> PublicPublishingConfig:
    config = get_public_publishing_config()
    missing_values = []
    if not config.service_url:
        missing_values.append("PUBLIC_SERVICE_URL")
    if not config.site_url:
        missing_values.append("PUBLIC_SITE_URL")
    if not config.publish_key:
        missing_values.append("PUBLIC_PUBLISH_KEY")

    if missing_values:
        missing = " and ".join(missing_values)
        raise PublicPublishingConfigurationError(f"{missing} must be configured before public publishing can be used.")

    return config


def send_json_request(
    method: str,
    url: str,
    publish_key: str | None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_body = None
    headers = {
        "Accept": "application/json",
        "User-Agent": PUBLISH_USER_AGENT,
    }

    if publish_key:
        headers["X-Publish-Key"] = publish_key

    if body is not None:
        request_body = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=request_body, headers=headers, method=method)

    try:
        with urlopen(request, timeout=PUBLISH_TIMEOUT_SECONDS) as response:
            response_body = response.read().decode("utf-8")
            return json.loads(response_body) if response_body else {}
    except HTTPError as exc:
        detail = read_error_detail(exc)
        raise PublicPublishingRemoteError(
            f"Public publishing service returned HTTP {exc.code}: {detail}"
        ) from exc
    except URLError as exc:
        raise PublicPublishingRemoteError(
            f"Could not reach public publishing service: {exc.reason}"
        ) from exc
    except TimeoutError as exc:
        raise PublicPublishingRemoteError("Timed out while contacting public publishing service.") from exc
    except json.JSONDecodeError as exc:
        raise PublicPublishingRemoteError("Public publishing service returned invalid JSON.") from exc


def read_error_detail(error: HTTPError) -> str:
    content_type = error.headers.get("content-type", "")

    try:
        response_body = error.read().decode("utf-8", errors="replace")
    except Exception:
        return error.reason or "Unknown error"

    if not response_body:
        return error.reason or "Unknown error"

    if "application/json" in content_type.lower():
        try:
            parsed_body = json.loads(response_body)
        except json.JSONDecodeError:
            return summarize_error_body(response_body)

        if isinstance(parsed_body, dict):
            detail = parsed_body.get("detail") or parsed_body.get("error")
            if isinstance(detail, str):
                return detail

    return summarize_error_body(response_body)


def summarize_error_body(response_body: str) -> str:
    body = response_body.strip()
    lower_body = body.lower()

    if "<html" in lower_body or "<!doctype html" in lower_body:
        return "Cloudflare returned an HTML error page before the Worker handled the request."

    single_line_body = " ".join(body.split())
    if not single_line_body:
        return "Unknown error"

    if len(single_line_body) > MAX_ERROR_DETAIL_LENGTH:
        return f"{single_line_body[:MAX_ERROR_DETAIL_LENGTH].rstrip()}..."

    return single_line_body
