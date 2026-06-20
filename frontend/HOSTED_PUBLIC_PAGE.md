# Hosted Public Page

The hosted public page reuses the existing local public tournament UI and changes only the data source.

The public site must be built with the public target so admin and desktop routes are not registered in the hosted build.

Local public page:

```text
/t/:id
-> local FastAPI /public/tournaments/:id
```

Hosted public page:

```text
/tournaments/:publicId
-> VITE_PUBLIC_SERVICE_URL/api/tournaments/:publicId
```

## Environment

Create `frontend/.env.public` locally when testing the hosted page:

```text
VITE_APP_TARGET=public
VITE_PUBLIC_SERVICE_URL=https://your-worker-url.workers.dev
```

No publish key is used by the public page.

## Local Development

```bash
cd frontend
npm install
npm run dev:public
```

Open:

```text
http://127.0.0.1:5173/tournaments/<publicId>
```

## Cloudflare Pages

Recommended settings:

```text
Framework preset: Vite
Build command: npm run build:public
Build output directory: dist
Root directory: frontend
```

Add these Pages environment variables:

```text
VITE_APP_TARGET=public
VITE_PUBLIC_SERVICE_URL=https://your-worker-url.workers.dev
```

The `public/_redirects` file enables direct visits to SPA routes such as `/tournaments/:publicId`.

The public target exposes only:

```text
/
/tournaments/:publicId
```

Admin routes such as `/admin` are not registered in the public router and redirect to the safe landing page.

## Snapshot Mapping

The Worker response:

```text
{ publicId, snapshot, status, updatedAt }
```

is adapted into the existing public page data shape:

```text
tournament.name       <- snapshot.tournament_name
tournament.location   <- snapshot.location
rounds                <- snapshot.current_round_number
matches               <- snapshot.current_round_pairings
standings             <- snapshot.standings
players count/search  <- snapshot metadata plus visible player names
lastUpdatedAt         <- snapshot.last_updated_at or updatedAt
```

COSSY IDs and local database IDs are not displayed.
