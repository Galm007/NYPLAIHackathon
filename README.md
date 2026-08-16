# MoveCheck NYC ("Should I Live Here")

A hackathon web app: enter an NYC address, get a **Building Health Score** and a
**Block Quality Score** (0–100, Good/Fair/Poor), both derived from real NYC 311
complaint data.

- **Frontend:** Next.js (App Router) — `frontend/`
- **Backend:** Node/Express API — `backend/`
- **Data source:** [NYC 311 Service Requests](https://data.cityofnewyork.us/resource/erm2-nwe9.json) (Socrata Open Data), live-queried and cached, scored against a precomputed citywide baseline
- **Geocoding:** Google Maps (Geocoding + Places Autocomplete), called from the frontend

---

## Architecture

```
 Browser
   │  address search
   ▼
 Next.js frontend (frontend/, :3000)
   │  geocodes via Google (/api/geocode, /api/autocomplete)
   │  POST { lat, lng }
   ▼
 Express backend (backend/, :3001)
   │  checks Mongo cache → falls back to live Socrata query on a miss
   │  scores counts against a precomputed baseline
   ▼
 NYC 311 Open Data (Socrata)  +  MongoDB (optional cache/baseline store)
```

The backend never geocodes — it only ever takes `{lat, lng}`. The frontend never
touches Socrata or Mongo directly — it only calls the backend's `/api/score`.

---

## Quick start

Prerequisites: **Node ≥ 20.6**, npm.

### 1. Backend

```bash
cd backend
cp .env.example .env      # then fill in SOCRATA_APP_TOKEN (see below)
npm install
npm run dev                # http://localhost:3001
```

`backend/.env`:

| Var | Required? | Notes |
|---|---|---|
| `SOCRATA_APP_TOKEN` | Recommended | Free at [data.cityofnewyork.us developer settings](https://data.cityofnewyork.us/profile/edit/developer_settings). Works without one, but requests throttle hard under load — register one before demoing. |
| `MONGODB_URI` | Optional | Atlas or local (`mongodb://127.0.0.1:27017`). Without it, the app runs **uncached** — every request hits Socrata live, no persistence. Scoring still works with zero Mongo, via the committed baseline fallback at `backend/src/config/baseline.json`. |
| `MONGODB_DB` | Optional | Defaults to `should_i_live_here`. |
| `PORT` | Optional | Defaults to `3001`. |
| `USE_MOCK_DATA` | Optional | Set to `1`/`true` to serve fake scores instead of hitting Socrata — useful for frontend work with no network/token/Mongo. |

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                # http://localhost:3000
```

Create `frontend/.env.local` yourself (it's gitignored, so it won't exist on a
fresh clone — nobody's key is committed to the repo):

```
GOOGLE_MAPS_API_KEY=your_key_here
```

`frontend/.env.local`:

| Var | Required? | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Yes, for real geocoding/map/autocomplete | Needs the **Geocoding API**, **Places API (New)**, and **Maps JavaScript API** enabled on the Google Cloud project. Without it, the map falls back to an error state and autocomplete falls back to a small local mock address list — the app still runs, just without real map/geocoding. |

With both running, open **http://localhost:3000**, search an NYC address, and
you'll get a live-scored report.

> **If the backend isn't running:** the frontend doesn't crash — `fetchReport()`
> catches the failed connection and falls back to a deterministic local mock
> generator (`frontend/lib/mock-data.ts`), so the UI still looks fully populated.
> This is convenient for frontend-only work, but it means **a working-looking
> report is not proof the backend is wired up** — check that something is
> actually listening on `:3001` if you need to confirm real data end-to-end.

---

## What's real vs. mocked/stubbed right now

Worth knowing before demoing or building on top of this:

| Feature | Backed by real data? |
|---|---|
| Building Health / Block Quality scores + per-category counts | **Yes**, once the backend is running (`POST /api/score` hits live 311 data) |
| Address search, autocomplete, map | **Yes**, via Google Maps APIs |
| "Recent Complaints" list on each report | **No** — `/api/score` doesn't return individual complaint records, only aggregate counts. This list currently only ever comes from the frontend's mock generator. The backend does have `GET /api/complaints` (individual points, built for a heatmap) that isn't wired to this list yet. |
| Complaint status timeline (Open → In Progress → Closed) | **No** — 311 doesn't expose per-complaint status history at all. This is an explicitly-labeled stub (`buildComplaintTimeline` in `mock-data.ts`) that synthesizes a plausible timeline from a complaint's date + current status. |
| Comment/reply threads on complaints | **No** — no backend support exists or is planned. Seeded + session-local only. |

So: trust the scores, don't trust the complaint list/timeline/comments as real
311 records — they're intentionally-scoped UI stubs with data shapes ready to
swap in real data later.

---

## Repo layout

```
backend/
  src/
    routes/       score.js, complaints.js, health.js
    services/     scoreService.js (orchestration), scoring.js (pure scoring fn), mockData.js
    providers/    socrata.js, cache.js, mongo.js, baseline.js
    config/       constants.js, baseline.json (committed fallback baseline)
  scripts/        buildBaseline.js, verifyDataset.js, verifyCache.js, verifyScoring.js
  test/           vitest suite, no network required
  API.md          full API reference with real sample requests/responses
  CLAUDE.md       backend architecture/data notes, decisions log
  documentation/  milestone write-ups (m0–m5), handoff notes

frontend/
  app/            Next.js App Router pages + API routes (geocode, autocomplete, report proxy)
  components/     UI components (ReportView, ScorePanelCard, MapPanel, ComplaintDetailModal, ...)
  lib/            api.ts (backend/Google client), mock-data.ts, score.ts, types.ts
```

## Testing

```bash
cd backend && npm test        # vitest, 200+ tests, no network needed
cd frontend && npm run build  # type-checks + builds; no dedicated test suite yet
```

## Further reading

- [`backend/API.md`](backend/API.md) — full endpoint reference with real captured responses
- [`backend/CLAUDE.md`](backend/CLAUDE.md) — data model, complaint-type mapping, scoring methodology, known caveats (e.g. `streetCondition`'s 25% null-geocode rate)
- [`backend/documentation/`](backend/documentation/) — milestone-by-milestone build notes
