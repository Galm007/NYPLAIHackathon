# CLAUDE.md

## Project: "Should I Live Here" (NYC 311 address risk tool)

A hackathon web app. User enters an NYC address; app returns one report with two
scores: a Building Health Score and a Block Quality Score, both derived from NYC
311 complaint data. This file covers the BACKEND / DATA layer only (Person 1).

## What this backend does

- Exposes an API that takes a coordinate and returns two 0-100 sub-scores.
- Queries NYC Open Data 311 live, caches results in Mongo, scores them against a
  precomputed citywide baseline.
- Does NOT geocode. The frontend sends {lat, lng} from Google Places Autocomplete.

## Architecture

Three layers, kept separate for testability:
routes (Express) -> services (scoring + orchestration) -> providers (Socrata + cache)

The route never calls Socrata directly. Service checks cache, falls back to
Socrata provider, then runs scoring. Scoring is a pure function tested against
fixtures with no network.

## Data source

- Dataset: NYC 311 Service Requests, Socrata UID `erm2-nwe9`
- Endpoint: https://data.cityofnewyork.us/resource/erm2-nwe9.json
- Auth: Socrata app token in `X-App-Token` header (register one; unauthenticated
  requests throttle hard under load)

## Two scores, six buckets (RESOLVED — see complaint_type strings below)

Building Health (tight radius ~20-30m): heat/hot water, unsanitary condition, plumbing
Block Quality (wider radius ~300-400m): noise, parking, street condition

Both use the same lat/lng with different radius sizes. No BBL join (that field is
not reliably present in 311 data).

## complaint_type strings — CONFIRMED against live API (RESOLVED, was open item 1)

Pulled via `$select=complaint_type&$group=complaint_type` against erm2-nwe9. Full
distinct list has ~280 values; only the ones relevant to our six buckets are below.
Do not re-derive these from memory elsewhere in the codebase, import from constants.js.

```js
// constants.js

const BUILDING_HEALTH_TYPES = {
  heatHotWater: ["HEAT/HOT WATER", "Heat/Hot Water"],
  unsanitaryCondition: ["UNSANITARY CONDITION", "Unsanitary Condition"],
  plumbing: ["PLUMBING", "Plumbing"],
};

const BLOCK_QUALITY_TYPES = {
  noise: [
    "Noise - Residential",
    "Noise - Street/Sidewalk",
    "Noise - Vehicle",
    "Noise - Commercial",
  ],
  parking: ["Illegal Parking", "Blocked Driveway"],
  streetCondition: ["Street Condition", "Sidewalk Condition", "DEP Street Condition"],
};
```

Decisions made and why (do not silently change these without updating this file):

1. **Dirty Condition / Dirty Conditions excluded from Unsanitary Condition.** These
   are a separate DSNY street/curb sanitation complaint_type, distinct from HPD's
   Unsanitary Condition (building interior). Building Health should reflect landlord
   maintenance, not curb sanitation, so excluded.
2. **General Construction/Plumbing excluded from Plumbing.** Ambiguous DOB combined
   category, not clearly plumbing-specific. Excluded to avoid overcounting.
3. **Non-Residential Heat excluded from Heat/Hot Water.** Commercial, not relevant
   to a residential livability score.
4. **Noise scope limited to 4 of 9 possible noise types** (Residential,
   Street/Sidewalk, Vehicle, Commercial). Helicopter, Park, House of Worship, and
   generic "Noise" excluded as not representative of daily block-level noise
   experience for a resident. Revisit if scores feel too low in noise-heavy areas
   near flight paths or parks.
5. **Blocked Driveway folded into the parking bucket** alongside Illegal Parking.
   Blocked Driveway alone is 1,056,637 records citywide, larger than some of
   Illegal Parking's own minor variants, so this materially changes the bucket if
   omitted.
6. **Sidewalk Condition folded into streetCondition**, not a separate 4th bucket,
   to preserve even weighting across 3 buckets per score. If sidewalk condition
   ever needs its own weight, it must be split out explicitly in the scoring
   function, not just added to the type list.

**Critical implementation note on weighting:** `getCounts` MUST sum all string
variants within a bucket into ONE number before scoring. Do not compute a
percentile per string and average those, buckets have different variant counts
(noise has 4 strings, plumbing has 1), and per-string averaging would silently
underweight noise relative to plumbing.

## API contract (FROZEN once agreed with team; do not change unilaterally)

POST /api/score
  body: { lat: number, lng: number }
  returns: {
    address: null,
    buildingHealth: { score, band, counts: {heatHotWater, unsanitaryCondition, plumbing}, radiusMeters },
    blockQuality:   { score, band, counts: {noise, parking, streetCondition}, radiusMeters }
  }
  ADDITIVE EXTENSIONS (M4/M5, no existing field changed name/type/meaning):
    each sub-score also carries: confidence ("normal"|"low"), confidenceReason
    (null | "no_complaints_found" | "no_baseline" | "stale_baseline_radius"),
    bucketScores {bucket: 0-100}, bucketConfidence {bucket: "low"} (non-normal only)
    and the payload carries: meta { windowMonths, baselineVersion, baselineSource,
    coord, cache }.  See documentation/handoff.md for the rationale.
  On upstream failure: 503 { error: "upstream_unavailable" }.

GET /api/complaints?lat=&lng=&radius=&limit=
  returns: [ { type, lat, lng, created_date, status }, ... ]   // for frontend heatmap
  headers: X-Complaints-Truncated: true|false, X-Complaints-Limit: <n>
  NOTE (M5): this is "the most recent N points", not the full window. NEVER count
  from it — a dense block hits the row cap and returns only its recent months.
  Counts come from /api/score, which aggregates server-side.

GET /health
  returns: 200 OK   // for deploy checks + keep-warm pings

band = "good" | "fair" | "poor"

## Socrata query pattern

Two HTTP calls per uncached address (one per radius tier), NOT six or twelve.
Group by type within each radius call:

  $where  = within_circle(<LOCATION_FIELD>, lat, lng, radius)
            AND complaint_type in (...)
            AND created_date > '<cutoff>'
  $select = complaint_type, count(*)
  $group  = complaint_type
  $limit  = 50000

Then sum the returned per-string counts into their bucket (see weighting note above).

Client must set: app token header, ~5s timeout, retry-with-backoff on 429/5xx (max 2).

## Scoring

score(counts, baseline) is a PURE function. IMPLEMENTED in src/services/scoring.js.
1. Per bucket: convert summed count to percentile position vs baseline for that
   bucket + radius tier.
2. Aggregate three bucket percentiles into one sub-score (start: simple mean).
3. Map to band at fixed thresholds.

Baseline is computed ONCE by scripts/buildBaseline.js (sample ~few hundred spread
NYC coords, compute median + p90 per bucket per tier, write one baseline doc, commit
output). This is what makes the score defensible vs a raw count map. Do not skip.

As built (M4), with two additions to the above:
- The baseline also records **zeroShare** per bucket, and the scorer reads it.
  These buckets are heavily zero-inflated; without it the first complaint at a
  location interpolates as barely worse than none.
- The baseline records the **radii it was sampled at**. It is only valid for
  those radii — retuning RADIUS_TIERS without rerunning buildBaseline.js marks
  scores `stale_baseline_radius` rather than silently shifting them.
- Committed output lives at `src/config/baseline.json` and is loaded when Mongo
  has no baseline document, so a fresh clone still produces real scores.

Config constants (radii, time window, weights, thresholds) live in /config/constants.js.
Time window: start at trailing 24 months, tunable.

## Mongo

collection complaint_cache:
  { lat (rounded ~4dp), lng (rounded), radiusTier: "building"|"block",
    counts: {...six buckets...}, createdAt }
  - compound index {lat, lng, radiusTier}
  - TTL index on createdAt (~24h) for self-refresh
  - NO 2dsphere index. Spatial filtering is done by Socrata, not Mongo. Cache
    lookup is exact key match on rounded coords.

collection baseline:
  { _id: "v1", perBucket: { <bucket>: {median, p90} }, radiusTier, computedAt }

  AS BUILT (M4) — one document, not one per tier. Bucket names are globally
  unique, so `perBucket` is flat and `radiusTier` became a `radiusMeters` map:
  { _id: "v1",
    perBucket: { <bucket>: { median, p90, zeroShare, mean, max, n } },
    radiusMeters: { building: 25, block: 350 },   // what the sample was taken at
    windowMonths, sampleSize, perTierSamples, sampleSources, computedAt }
  The same document is committed to src/config/baseline.json and is used when
  Mongo has none, so the API scores correctly with no Mongo at all.

## Repo shape

/src
  /routes      score.js, complaints.js, health.js
  /services    scoreService.js, scoring.js (pure), mockData.js
  /providers   socrata.js, cache.js, mongo.js, baseline.js
  /lib         validate.js
  /config      constants.js, baseline.json (COMMITTED ARTIFACT — keep in git)
/scripts       buildBaseline.js, verifyDataset.js, verifyCache.js, verifyScoring.js
/test          scoring, baseline, cache, socrata, scoreService, routes, validate,
               constants, mockData  (209 tests, no network)

## OPEN ITEMS — verify against live API before building on top

Re-run `node scripts/verifyDataset.js` to re-check items 2-4 at any time.
Full findings: `documentation/m2-socrata-client.md`.

1. ~~Exact complaint_type strings~~ — RESOLVED, see table above.
2. ~~Exact geolocation column name for within_circle~~ — **RESOLVED (2026-08-15).**
   The column is `location`, a Point geometry. The `latitude`/`longitude` fields
   are numbers and are REJECTED by within_circle with a type-mismatch error.
   Stored as `LOCATION_FIELD` in constants.js.
3. ~~Null-geocoding rate PER bucket~~ — **RESOLVED (2026-08-15), one problem found.**
   Measured over the trailing 24mo, summed at bucket level:
   | bucket | n | null geo |
   |---|---|---|
   | heatHotWater | 651,234 | 0.01% |
   | unsanitaryCondition | 247,618 | 0.01% |
   | plumbing | 156,235 | 0.04% |
   | noise | 1,450,296 | 0.35% |
   | parking | 1,514,213 | 0.48% |
   | **streetCondition** | **236,517** | **25.60%** |
   Five of six buckets are effectively fully geocoded — the CLAUDE.md guess that
   plumbing/unsanitary would be spotty was wrong, they are the cleanest.
   **streetCondition is the problem**, driven by `Street Condition` (32.6% null,
   all from DOT). The nulls are NOT uniform: by borough they run 19.1% (Manhattan)
   to 31.1% (Queens), so this biases cross-borough comparison rather than
   cancelling out against the baseline. 99.6% of the null rows do still carry
   `incident_address`, so an address-geocoding fallback is possible but is not
   hackathon-scoped. DECISION PENDING — see handoff.md.
4. ~~Dataset title / date range~~ — **RESOLVED (2026-08-15).** Title is now
   "311 Service Requests **from 2020** to Present" (was "from 2010"). Data runs
   2020-01-01 to present, updated daily. Our trailing 24mo window sits safely
   inside that, but a window longer than ~68 months would silently truncate.
5. Tight building radius may bleed into adjacent buildings on dense blocks. Person 3
   owns radius testing; coordinate before trusting building scores.
   **Partial finding (2026-08-15):** 25m is sound *only if* the frontend sends a
   rooftop-accurate coordinate. Tested against real 311 building coords, 25m
   captures the building's own complaints and bleeds <1% vs 50m. But an arbitrary
   mid-street coordinate returns ZERO building complaints — which scores as a
   perfect building. This is the dangerous failure mode: a bad coordinate looks
   like good news. Frontend must send rooftop-precision coords, not
   street-interpolated ones.
   **Mitigated in M4:** an all-zero tier is returned with `confidence: "low"` and
   `confidenceReason: "no_complaints_found"`. That is a safety net, not a
   substitute for a good coordinate.

6. **Baseline sampling must be per-tier** (found in M4, do not undo). Building-tier
   sample coordinates come only from HPD building-interior complaint types; block
   -tier from all types. Sampling both from one pooled draw puts street-geocoded
   complaints (Illegal Parking, Street Condition) into the building distribution —
   36.5% of points had zero building complaints — which drags the building median
   to ~1 and scores every real building against a distribution that is mostly not
   buildings. See `documentation/m4-m5-scoring-integration.md`.

## Build order

P0: Express skeleton + MOCKED /api/score in frozen shape, deployed. Unblocks team. DONE
P1: Socrata client + null-geocoding check (item 3). Item 1 already resolved above. DONE
P2: real getCounts (with bucket-level summing) + cache read/write + TTL. DONE
P3: buildBaseline.js, then score() against it. DONE
P4: swap mock for real, integrate. Budget full time; clean integration is rare. DONE
P5: pre-warm cache for demo addresses; serve cached value on live-API failure;
    keep backend warm (free tiers cold-start and look broken mid-demo). NEXT

## Conventions

- Live-proxy + cache. NOT bulk ingest (millions of rows would blow free Atlas tier).
- Validate coords in NYC bounds (~lat 40.4-40.95, lng -74.3 to -73.7); 400 on bad input.
- Do not put personal data or coordinates in logs beyond what debugging needs.
