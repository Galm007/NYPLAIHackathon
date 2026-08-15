# API reference — "Should I Live Here"

Backend for the NYC 311 address risk tool. Takes a coordinate, returns two
0–100 scores derived from live NYC 311 complaint data.

- **Base URL (local):** `http://localhost:3001`
- **Auth:** none. The Socrata app token is server-side only.
- **Content type:** `application/json` everywhere.
- **CORS:** open (`Access-Control-Allow-Origin: *`), preflight answered with 204.

All samples below are real responses captured from a running server, not
illustrations.

---

## Two things to know before integrating

**1. This API does not geocode.** It takes `{lat, lng}` and never converts an
address. The frontend gets coordinates from Google Places Autocomplete and sends
those. Send **rooftop-precision** coordinates — a street-interpolated or
mid-block coordinate finds no building complaints and scores as a *perfect*
building. The response flags this (see `confidenceReason: "no_complaints_found"`),
but the flag is a safety net, not a fix.

**2. Never count from `/api/complaints`.** It returns the most recent N points
and truncates on dense blocks. All counts come from `/api/score`, which
aggregates server-side over the full window.

---

## `POST /api/score`

The main endpoint. Returns Building Health and Block Quality for one coordinate.

### Request

```jsonc
{
  "lat": 40.698,   // required, 40.4 – 40.95
  "lng": -73.921   // required, -74.3 – -73.7
}
```

Both fields accept numbers or numeric strings. Coordinates outside the NYC
bounding box are rejected with `400 out_of_bounds`.

### Sample request

```bash
curl -X POST http://localhost:3001/api/score \
  -H 'Content-Type: application/json' \
  -d '{"lat": 40.698, "lng": -73.921}'
```

```js
const res = await fetch("http://localhost:3001/api/score", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ lat: 40.698, lng: -73.921 }),
});
if (!res.ok) throw new Error((await res.json()).error);
const report = await res.json();
```

### Sample response — `200 OK`

Bushwick, Brooklyn. A well-maintained building on a loud block:

```json
{
  "address": null,
  "buildingHealth": {
    "score": 91,
    "band": "good",
    "counts": {
      "heatHotWater": 5,
      "unsanitaryCondition": 0,
      "plumbing": 1
    },
    "radiusMeters": 25,
    "confidence": "normal",
    "confidenceReason": null,
    "bucketScores": {
      "heatHotWater": 88,
      "unsanitaryCondition": 100,
      "plumbing": 86
    },
    "bucketConfidence": {}
  },
  "blockQuality": {
    "score": 36,
    "band": "poor",
    "counts": {
      "noise": 2876,
      "parking": 1253,
      "streetCondition": 144
    },
    "radiusMeters": 350,
    "confidence": "normal",
    "confidenceReason": null,
    "bucketScores": {
      "noise": 18,
      "parking": 46,
      "streetCondition": 44
    },
    "bucketConfidence": {
      "streetCondition": "low"
    }
  },
  "meta": {
    "windowMonths": 24,
    "baselineVersion": "v1",
    "baselineSource": "mongo",
    "coord": { "lat": 40.698, "lng": -73.921 },
    "cache": { "building": "hit", "block": "hit" }
  }
}
```

### Field reference

| Field | Type | Meaning |
| --- | --- | --- |
| `address` | `null` | Always null. We do not geocode. |
| `buildingHealth` | object | 25m radius: heat/hot water, unsanitary condition, plumbing |
| `blockQuality` | object | 350m radius: noise, parking, street condition |
| `meta` | object | Non-scoring context; safe to ignore |

Each sub-score object:

| Field | Type | Meaning |
| --- | --- | --- |
| `score` | `0–100` int | **100 = fewest complaints = best.** Mind the direction. |
| `band` | `"good"` \| `"fair"` \| `"poor"` | `good ≥ 70`, `fair ≥ 40`, else `poor` |
| `counts` | `{bucket: int}` | Raw complaint counts over the trailing 24 months |
| `radiusMeters` | int | The circle these counts came from (25 or 350) |
| `confidence` | `"normal"` \| `"low"` | Whether to trust this sub-score |
| `confidenceReason` | string \| `null` | Why it is low; `null` when normal |
| `bucketScores` | `{bucket: 0–100}` | Per-bucket score, same direction as `score` |
| `bucketConfidence` | `{bucket: "low"}` | **Only lists non-normal buckets.** `{}` means all solid. |

`meta`:

| Field | Meaning |
| --- | --- |
| `windowMonths` | Trailing window the counts cover (24) |
| `baselineVersion` | Which citywide baseline scored this (`"v1"`) |
| `baselineSource` | `"mongo"`, `"file"`, or `"mock"` |
| `coord` | The **rounded** coordinate actually queried (~11m from what you sent) |
| `cache` | `"hit"` or `"miss"` per tier — `"hit"` responses are ~2ms |
| `mock` | Present and `true` only in mock mode |

### How the score is computed

A raw count means nothing to a renter — "47 noise complaints" is not
interpretable. Each count is placed against a **citywide baseline** built from
~250 sampled NYC locations per tier, then inverted:

| Your count is… | Score |
| --- | --- |
| zero | 100 |
| at the citywide median | 50 |
| at the citywide p90 | 10 |
| far above p90 | 0 |

The three bucket scores are averaged into the sub-score. So `blockQuality: 36`
means *this block is worse than a typical NYC block*, not "36 complaints".

### Confidence

Show the score, but qualify it when `confidence` is `"low"`:

| `confidenceReason` | What happened | Suggested UI |
| --- | --- | --- |
| `no_complaints_found` | Every bucket returned 0 | "No records found at this location — this may not be a building address." **Do not present as good news.** |
| `no_baseline` | No citywide baseline available | "Score is not comparable to the rest of the city." |
| `stale_baseline_radius` | Baseline was built at a different radius | Backend misconfiguration — surface to the team, not the user |

`bucketConfidence` is separate and per-bucket. Today it always contains
`streetCondition: "low"`: 25.6% of Street Condition records have no coordinates,
and the missing rate varies by borough (19% Manhattan → 31% Queens), so that
bucket is weaker than the other five. De-emphasize it visually rather than
presenting it as equally solid.

### Sample response — low confidence

A mid-street coordinate. Note the score is 100 and the confidence is `low` — this
is the failure mode the flag exists for:

```json
{
  "score": 100,
  "band": "good",
  "counts": {
    "heatHotWater": 0,
    "unsanitaryCondition": 0,
    "plumbing": 0
  },
  "radiusMeters": 25,
  "confidence": "low",
  "confidenceReason": "no_complaints_found",
  "bucketScores": {
    "heatHotWater": 100,
    "unsanitaryCondition": 100,
    "plumbing": 100
  },
  "bucketConfidence": {}
}
```

### Latency

| Case | Time |
| --- | --- |
| Cached (`meta.cache` all `"hit"`) | ~2ms |
| Uncached | 1.6–2.5s (two upstream calls) |

Cache entries live 24h. Pre-warm any address you intend to demo.

---

## `GET /api/complaints`

Individual complaint points for the heatmap.

### Query parameters

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `lat` | yes | — | Must be inside NYC bounds |
| `lng` | yes | — | Must be inside NYC bounds |
| `radius` | no | `350` | Meters, 1–2000 |
| `limit` | no | `1000` | Whole number, 1–5000 |

### Sample request

```bash
curl -i "http://localhost:3001/api/complaints?lat=40.698&lng=-73.921&radius=350&limit=3"
```

### Sample response — `200 OK`

```
X-Complaints-Truncated: true
X-Complaints-Limit: 3
```

```json
[
  {
    "type": "Sidewalk Condition",
    "lat": 40.69878996018205,
    "lng": -73.9184379499003,
    "created_date": "2026-08-14T00:21:33.000",
    "status": "In Progress"
  },
  {
    "type": "Noise - Street/Sidewalk",
    "lat": 40.697266756427595,
    "lng": -73.922619521571,
    "created_date": "2026-08-13T21:46:38.000",
    "status": "Closed"
  },
  {
    "type": "Noise - Commercial",
    "lat": 40.69805399996578,
    "lng": -73.92187209378284,
    "created_date": "2026-08-13T21:12:11.000",
    "status": "Closed"
  }
]
```

`status` may be `null`. `type` is the raw 311 `complaint_type` string.

### Truncation — read this

Rows come back newest-first and stop at `limit`. On a dense block that means you
receive only the **most recent months**, not the full 24-month window — Bushwick
at 350m fills 1000 rows with just 148 days of data. Truncation is also uneven
between neighbourhoods, so point density is **not comparable across addresses**.

Two headers report it:

| Header | Meaning |
| --- | --- |
| `X-Complaints-Truncated` | `"true"` if the row cap was hit |
| `X-Complaints-Limit` | The cap actually applied |

Both are listed in `Access-Control-Expose-Headers`, so cross-origin JS can read
them:

```js
const res = await fetch(url);
const points = await res.json();
if (res.headers.get("X-Complaints-Truncated") === "true") {
  // showing recent activity only — say so, don't imply completeness
}
```

The response body stays a bare array because that shape is frozen. **Use this
endpoint for visual density only; take every number from `/api/score`.**

---

## `GET /health`

For deploy checks and keep-warm pings. No dependencies — answers even when
Mongo and Socrata are both down.

```bash
curl http://localhost:3001/health
```

```json
{ "status": "ok", "uptimeSeconds": 3 }
```

---

## Errors

All errors are JSON: `{ "error": "<code>", "details": "<human readable>" }`.
`details` is present on every 400 and on 503; it is omitted on 404 and 500,
where there is nothing useful to say that would not leak internals.

| Status | `error` | Cause |
| --- | --- | --- |
| 400 | `missing_lat` / `missing_lng` | Field absent or empty |
| 400 | `invalid_lat` / `invalid_lng` | Not a number |
| 400 | `out_of_bounds` | Outside the NYC bounding box |
| 400 | `invalid_radius` | Not 1–2000 meters |
| 400 | `invalid_limit` | Not a whole number in 1–5000 |
| 404 | `not_found` | Unknown path |
| 503 | `upstream_unavailable` | NYC Open Data is not responding |
| 500 | `internal_error` | Anything else; details are not leaked |

Examples:

```bash
$ curl -X POST localhost:3001/api/score -H 'Content-Type: application/json' \
    -d '{"lat":34.05,"lng":-118.24}'
{"error":"out_of_bounds","details":"coordinate must be within NYC (lat 40.4-40.95, lng -74.3 to -73.7)"}

$ curl -X POST localhost:3001/api/score -H 'Content-Type: application/json' \
    -d '{"lng":-73.9}'
{"error":"missing_lat","details":"lat is required"}

$ curl localhost:3001/api/nope
{"error":"not_found"}
```

### Handling `503 upstream_unavailable`

NYC Open Data has gone fully dark for hours at a time. A 503 means the upstream
is down, not that the address is bad — retry, and tell the user "NYC's data
service is unavailable" rather than showing a generic failure. Cached addresses
keep working during an outage.

---

## Buckets

Six buckets across two tiers. Each is the sum of several raw 311
`complaint_type` strings.

| Tier | Bucket | 311 complaint types |
| --- | --- | --- |
| building (25m) | `heatHotWater` | HEAT/HOT WATER |
| building | `unsanitaryCondition` | UNSANITARY CONDITION |
| building | `plumbing` | PLUMBING |
| block (350m) | `noise` | Noise - Residential, Street/Sidewalk, Vehicle, Commercial |
| block | `parking` | Illegal Parking, Blocked Driveway |
| block | `streetCondition` | Street Condition, Sidewalk Condition, DEP Street Condition |

The three HPD buckets also match title-case variants (`Heat/Hot Water`, etc.) as
insurance against the city changing case. Those match zero rows today.

Deliberately excluded: Dirty Conditions (DSNY street sanitation, not a landlord
issue), General Construction/Plumbing (ambiguous), Non-Residential Heat, and
Noise - Helicopter / Park / House of Worship. See `CLAUDE.md` for the reasoning.

All variants within a bucket are summed into **one** number before scoring — the
`counts` you receive are already bucket totals, never per-string.

---

## Running locally

```bash
npm install
npm start          # http://localhost:3001
npm run dev        # same, with --watch
```

| Env var | Required | Purpose |
| --- | --- | --- |
| `SOCRATA_APP_TOKEN` | for live data | NYC Open Data token; requests throttle hard without it |
| `MONGODB_URI` | no | Enables the cache. Absent = slower, not broken |
| `MONGODB_DB` | no | Defaults to `should_i_live_here` |
| `PORT` | no | Defaults to 3001 |
| `USE_MOCK_DATA` | no | `1` serves deterministic mock data |

### Mock mode

```bash
USE_MOCK_DATA=1 npm start
```

Serves the identical response shape with deterministic fake data — no token, no
Mongo, no network. The same coordinate always returns the same report, and all
three bands are reachable. Mock payloads carry `meta.mock: true`, so nothing can
be demoed as live data by accident.

---

## Related docs

| Doc | Covers |
| --- | --- |
| `CLAUDE.md` | The spec — buckets, radii, architecture |
| `documentation/handoff.md` | Decisions, roadblocks, current state |
| `documentation/m4-m5-scoring-integration.md` | How scoring and the baseline work |
