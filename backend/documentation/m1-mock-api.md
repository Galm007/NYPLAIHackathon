# M1 — P0: Express skeleton + mocked API

**Status:** complete
**Covers:** all three endpoints of the frozen contract, serving mocked data

## Goal

Ship the frozen API contract with fake numbers so the frontend can build against
real response shapes immediately, without waiting on Socrata, Mongo, or the
baseline. Per CLAUDE.md's build order, P0 exists to unblock the team.

## What was built

| File | Role |
| --- | --- |
| `src/routes/health.js` | `GET /health` |
| `src/routes/score.js` | `POST /api/score` |
| `src/routes/complaints.js` | `GET /api/complaints` |
| `src/lib/validate.js` | Shared coordinate/radius validation + `BadRequestError` |
| `src/services/scoring.js` | `bandFor(score)` — the only place thresholds are applied |
| `src/services/mockData.js` | Deterministic fake reports and complaint points |
| `src/app.js` | Mounts routers, CORS, 404, central error handler |

## Endpoints

### `GET /health`
```json
{ "status": "ok", "uptimeSeconds": 42 }
```
Deliberately dependency-free — it must answer 200 even when Mongo and Socrata are
down. A health check wired to a database is a health check that recycles your
instance mid-demo.

### `POST /api/score` — body `{ lat, lng }`
```json
{
  "address": null,
  "buildingHealth": {
    "score": 53, "band": "fair",
    "counts": { "heatHotWater": 8, "unsanitaryCondition": 9, "plumbing": 0 },
    "radiusMeters": 25
  },
  "blockQuality": {
    "score": 51, "band": "fair",
    "counts": { "noise": 195, "parking": 180, "streetCondition": 5 },
    "radiusMeters": 350
  }
}
```
`address` is always `null` — this backend does not geocode, by design.

### `GET /api/complaints?lat=&lng=&radius=`
```json
[ { "type": "Plumbing", "lat": 40.7482, "lng": -73.9864,
    "created_date": "2025-11-07T11:34:24.124Z", "status": "Open" } ]
```
`radius` is optional, defaulting to the block tier (350m), capped at 2000m.

## Decisions

1. **Mock data is deterministic, derived from the coordinate — never random.**
   `mockData.js` seeds a Mulberry32 PRNG from an FNV-1a hash of the rounded
   lat/lng. The same address always returns the same report; different addresses
   return visibly different ones.
   **Why it matters:** random mocks make frontend work miserable — you can't tell
   a re-render from new data, and you can't screenshot a stable state for design
   review. It also pre-simulates the caching behavior that arrives in M3.

2. **Mock magnitudes differ per tier** (building maxes ~12 per bucket, block
   ~260). A 25m circle genuinely sees far fewer complaints than a 350m one, and
   the frontend is laying out number fields against these — three-digit block
   counts next to single-digit building counts is the real shape of the data.

3. **`bandFor()` lives in `scoring.js`, not in the mock.** The mock's *scores*
   are throwaway, but the score→band mapping is real logic and ships to
   production. Putting it in the mock would guarantee a divergence at M5.

4. **Validation centralized in `src/lib/validate.js`**, throwing `BadRequestError`
   (`status: 400`) that a single Express error handler translates. Both routes
   share it, so the NYC-bounds rule cannot drift between them.

5. **Empty string is rejected explicitly.** `Number("")` is `0`, so a query like
   `?lat=&lng=` would otherwise parse as a valid coordinate off the coast of
   Africa — and `0,0` is outside NYC bounds, so it would surface as a confusing
   `out_of_bounds` rather than the true `missing_lat`.

6. **CORS is wide open (`*`).** Fine for a hackathon with a not-yet-known
   frontend origin. Listed in the handoff as a pre-production item.

7. **Error responses are `{ error, details }`** with a machine-readable slug
   (`out_of_bounds`, `missing_lng`, `invalid_radius`) plus a human string. The
   frontend can branch on `error` without string-matching prose.

## Roadblocks

**None blocking.** One thing worth recording:

- `npm run dev` initially used `node --env-file=.env`, which **exits with an
  error if `.env` is absent** — meaning a teammate cloning the repo would hit a
  crash on first run before receiving any credentials. Switched to
  `--env-file-if-exists=.env`, which warns and continues. Verified by booting
  with no `.env` present.

## Verification

Server booted, every endpoint curled including failure cases:

| Case | Result |
| --- | --- |
| `GET /health` | `200` `{"status":"ok"}` |
| `POST /api/score` Empire State Bldg | `200`, frozen shape |
| `POST /api/score` Bushwick | `200`, **different** values |
| `POST /api/score` Empire State again | **byte-identical** to first call |
| London coords | `400 out_of_bounds` |
| missing `lng` | `400 missing_lng` |
| `lat: "abc"` | `400 invalid_lat` |
| `{}` empty body | `400 missing_lat` |
| `GET /api/complaints` r=100 | `200`, 32 points, all inside the circle |
| `radius=99999` | `400 invalid_radius` |

## Note for the frontend

The sibling `front/` app currently calls its own Next.js mock routes
(`/api/report?address=`, `/api/autocomplete?q=`) — **address-keyed**, whereas
this backend is **coordinate-keyed** and does not geocode. Bridging that is a
frontend-side change (Google Places Autocomplete supplies the `{lat, lng}`), but
it is a real integration seam and nobody should discover it at demo time.
