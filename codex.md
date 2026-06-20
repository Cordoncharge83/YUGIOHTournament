# Yu-Gi-Oh Tournament Manager - Project Rules

## Product Shape

This is a local-first Yu-Gi-Oh tournament companion for organizers using Konami Tournament Software.

The app does not replace KTS. KTS remains the event source, and this app provides:

- Tauri desktop organizer UI
- Packaged FastAPI backend sidecar
- SQLite storage in the desktop AppData directory
- KTS `.Tournament` import and auto-sync
- Hosted public snapshot publishing
- Cloudflare Pages public tournament viewer

## Current Architecture

Desktop app:

```text
Tauri React admin UI
-> local FastAPI backend at http://127.0.0.1:8000
-> SQLite in AppData
```

Hosted public flow:

```text
Desktop backend
-> Cloudflare Worker snapshot API
-> Cloudflare Pages public site at /tournaments/:publicId
```

## Guardrails

- Do not replace KTS behavior.
- Do not introduce user accounts/auth until explicitly requested.
- Do not expose COSSY IDs, local file paths, publish keys, or local database IDs in public pages.
- Keep the public site route-limited to player-facing pages.
- Keep desktop/admin routes out of the public build.
- Keep the backend local-first and SQLite-based.
- Avoid broad architecture refactors during tournament-day reliability work.

## Development Rules

- Prefer small, explicit changes over broad refactors.
- Preserve existing API behavior unless a task explicitly changes it.
- Do not split large files just for cleanup before organizer testing.
- Keep publish keys out of committed files.
- Use AppData settings for installed-app local configuration.
- Keep Cloudflare Worker API changes isolated to `public-service/`.

## Build Targets

- Desktop dev/build uses Vite desktop mode and the Tauri app.
- Hosted public dev/build uses Vite public mode.
- Tauri release packages the FastAPI backend with PyInstaller as a sidecar resource.
