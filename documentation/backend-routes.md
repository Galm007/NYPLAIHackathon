# Backend — Routes (`backend/src/routes/`)

Three route modules, each mounted directly onto the Express app in
`src/app.js`. All validation lives in `src/lib/validate.js` and is shared
across routes — see [`backend-providers.md`](./backend-providers.md) for the
providers these routes sit on top of.

---

## `POST /api/score` — `score.js`

The main endpoint. One coordinate in, two scores out.

**Request body:**
```json
{ "lat": 40.698, "lng": -73.921 }
```
Both fields accept numbers or numeric strings. Rejected with `400
out_of_bounds` if outside the NYC bounding box (`lat 40.4–40.95`,
`lng -74.3 to -73.7`).

**Response (frozen shape — see `backend/CLAUDE.md` before changing):**
```jsonc
{
  "address": null,          // this API never geocodes
  "buildingHealth": {
    "score": 62, "band": "fair",
    "counts": { "heatHotWater": 3, "unsanitaryCondition": 1, "plumbing": 2 },
    "radiusMeters": 25,
    "confidence": "normal", "confidenceReason": null,
    "bucketScores": { "heatHotWater": 58, "unsanitaryCondition": 71, "plumbing": 60 },
    "bucketConfidence": {}
  },
  "blockQuality": { /* same shape, buckets: noise, parking, streetCondition, radiusMeters: 350 */ },
  "meta": {
    "windowMonths": 24, "baselineVersion": "v1", "baselineSource": "mongo",
    "coord": { "lat": 40.698, "lng": -73.921 },
    "cache": { "building": "hit", "block": "miss" }
  }
}
```

- `band` is `"good" | "fair" | "poor"`.
- `confidence` is `"normal" | "low"`; `confidenceReason` explains a low
  reading — see [`backend-services.md`](./backend-services.md#confidence).
- On upstream failure: `503 { "error": "upstream_unavailable" }`.
- Delegates entirely to `services/scoreService.js#buildScoreReport()`.

---

## `GET /api/complaints` — `complaints.js`

Individual complaint **points**, not counts — built for a frontend heatmap,
not for computing totals.

**Query params:** `lat`, `lng` (required), `radius` (meters, optional,
defaults to the block tier's radius, capped at 2000m), `limit` (optional,
default 1000, max 5000).

**Response:** a bare JSON array (kept as an array deliberately — wrapping it
in an object would be cleaner but would break every existing caller):
```jsonc
[
  { "type": "Noise - Residential", "lat": 40.698, "lng": -73.921, "created_date": "2026-06-01T00:00:00.000", "status": "Closed" },
  ...
]
```

**Truncation is reported in headers, not the body:**
```
X-Complaints-Truncated: true | false
X-Complaints-Limit: <the row cap actually applied>
```

> **Never count from this endpoint.** Socrata returns the most *recent* N
> rows, so a dense block hitting the row cap silently loses its older months
> — a naive `.length` here would disagree with `/api/score`, which aggregates
> server-side over the *full* window. This endpoint exists for a map/heatmap
> view, not for totals.

---

## `GET /health` — `health.js`

```json
{ "status": "ok", "uptimeSeconds": 1234 }
```

Deliberately dependency-free — it must return `200` even if Mongo or Socrata
are down, or a host's deploy/keep-warm check would recycle the instance
mid-demo for the wrong reason.

---

## Error handling

All three routes rely on the central error middleware in `src/app.js`:

| Thrown as | HTTP status | Body |
|---|---|---|
| `BadRequestError` (from `lib/validate.js`) | 400 | `{ error, details }` |
| `SocrataError` (upstream Socrata failure after retries) | 503 | `{ error: "upstream_unavailable", details }` |
| anything else | 500 | `{ error: "internal_error" }` (no internals leaked) |

Unmatched routes return `404 { "error": "not_found" }`.
