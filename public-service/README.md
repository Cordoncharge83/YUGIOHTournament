# Hosted Public Tournament Service

Standalone Cloudflare Worker API for hosted Yu-Gi-Oh tournament snapshots.

This service is intentionally separate from the local FastAPI backend and desktop app. It stores only the latest public-safe snapshot for each `publicId` and serves that snapshot to a future online public page.

## Storage

This skeleton uses Cloudflare Workers KV.

KV is the simplest fit for the first hosted service because the access pattern is direct key/value lookup:

- write latest snapshot by `publicId`
- read latest snapshot by `publicId`
- mark one snapshot as unpublished

There is no relational querying yet, so D1 would add schema and migration work before it is needed.

## Endpoints

```text
GET  /api/health
PUT  /api/tournaments/:publicId
GET  /api/tournaments/:publicId
POST /api/tournaments/:publicId/unpublish
```

### `GET /api/health`

Returns:

```json
{
  "status": "ok"
}
```

### `PUT /api/tournaments/:publicId`

Requires:

```text
X-Publish-Key: <publish key>
Content-Type: application/json
```

Stores:

```json
{
  "publicId": "regional-main-event-1a2b3c4d",
  "snapshot": {},
  "status": "published",
  "updatedAt": "2026-06-20T10:00:00.000Z"
}
```

The request body is the public snapshot JSON produced by the local backend. The Worker validates that the body is an object with the public snapshot shape, strips a top-level `tournament_id`/`tournamentId` if present, and rejects obvious private/internal fields such as COSSY IDs, local file paths, saved KTS paths, and nested local database IDs.

Example request body:

```json
{
  "tournament_name": "Saturday WCQ",
  "location": "Local Game Store",
  "current_round_number": 2,
  "current_round_name": "Round 2",
  "last_updated_at": "2026-06-20T10:00:00Z",
  "public_display_status": "published",
  "current_round_pairings": [
    {
      "table_number": 1,
      "player_one_name": "Alex",
      "player_two_name": "Sam",
      "result_status": "UNREPORTED",
      "notes": null
    }
  ],
  "standings": [
    {
      "rank": 1,
      "player_name": "Alex",
      "points": 3,
      "tiebreaker": "100%"
    }
  ],
  "metadata": {
    "total_players": 16,
    "total_rounds": 2,
    "unreported_match_count": 8
  }
}
```

### `GET /api/tournaments/:publicId`

Public endpoint. Returns the latest snapshot only when status is `published`.

Unavailable response:

```json
{
  "error": "Tournament snapshot is unavailable"
}
```

### `POST /api/tournaments/:publicId/unpublish`

Requires:

```text
X-Publish-Key: <publish key>
```

Marks the tournament as `unpublished` without deleting the stored snapshot.

## Required Configuration

Secrets:

```text
PUBLISH_KEY
```

KV binding:

```text
TOURNAMENT_SNAPSHOTS
```

Create the KV namespace:

```bash
npx wrangler kv namespace create TOURNAMENT_SNAPSHOTS
npx wrangler kv namespace create TOURNAMENT_SNAPSHOTS --preview
```

Copy the returned IDs into `wrangler.toml`.

Set the publish key secret:

```bash
npx wrangler secret put PUBLISH_KEY
```

For local development, create `.dev.vars`:

```text
PUBLISH_KEY=local-dev-publish-key
```

Do not commit `.dev.vars`.

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Default local URL:

```text
http://127.0.0.1:8787
```

## Deploy

```bash
npm run deploy
```

Wrangler also supports the direct command:

```bash
npx wrangler deploy
```

## Curl Examples

Set a base URL:

```bash
BASE_URL=http://127.0.0.1:8787
PUBLISH_KEY=local-dev-publish-key
PUBLIC_ID=regional-main-event-1a2b3c4d
```

Health check:

```bash
curl "$BASE_URL/api/health"
```

Publish snapshot:

```bash
curl -X PUT "$BASE_URL/api/tournaments/$PUBLIC_ID" \
  -H "Content-Type: application/json" \
  -H "X-Publish-Key: $PUBLISH_KEY" \
  --data @examples/public-snapshot.json
```

Get snapshot:

```bash
curl "$BASE_URL/api/tournaments/$PUBLIC_ID"
```

Unpublish:

```bash
curl -X POST "$BASE_URL/api/tournaments/$PUBLIC_ID/unpublish" \
  -H "X-Publish-Key: $PUBLISH_KEY"
```

## Safety Notes

The hosted API only accepts the public snapshot format. It should not receive or expose:

- COSSY IDs
- local file paths
- saved KTS file paths
- internal admin-only fields
- local database IDs, where avoidable

This is a publishing skeleton only. It does not add user accounts, organizer dashboards, custom domains, rate limiting, or changes to the local desktop app.
