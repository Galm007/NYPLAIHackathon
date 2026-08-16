# Backend — Config & Scripts

## `src/config/constants.js` — single source of truth

Every tunable value in the backend lives here. Complaint-type strings in
particular must **never** be re-derived elsewhere — always import from this
file (see `backend/CLAUDE.md` for the full reasoning behind each inclusion
and exclusion decision).

### Dataset

| Constant | Value | Notes |
|---|---|---|
| `SOCRATA_DATASET_ID` | `erm2-nwe9` | NYC 311 Service Requests |
| `SOCRATA_ENDPOINT` | `https://data.cityofnewyork.us/resource/erm2-nwe9.json` | |
| `LOCATION_FIELD` | `"location"` | The geo-typed column `within_circle()` requires — `latitude`/`longitude` are plain numbers and get rejected with a type-mismatch error |

### The six complaint buckets

| Tier | Bucket | 311 `complaint_type` values |
|---|---|---|
| **building** (25m) | `heatHotWater` | `HEAT/HOT WATER`, `Heat/Hot Water` |
| | `unsanitaryCondition` | `UNSANITARY CONDITION`, `Unsanitary Condition` |
| | `plumbing` | `PLUMBING`, `Plumbing` |
| **block** (350m) | `noise` | `Noise - Residential`, `Noise - Street/Sidewalk`, `Noise - Vehicle`, `Noise - Commercial` |
| | `parking` | `Illegal Parking`, `Blocked Driveway` |
| | `streetCondition` | `Street Condition`, `Sidewalk Condition`, `DEP Street Condition` |

`TYPE_TO_BUCKET` is the flat reverse lookup (`complaint_type string → bucket
name`) that `socrata.js` uses to sum every string variant into one number per
bucket — critical, because per-string scoring would underweight buckets with
more variants (noise has 4 strings, plumbing has 2).

### Time window & scoring knobs

| Constant | Value | Meaning |
|---|---|---|
| `WINDOW_MONTHS` | 24 | Trailing window for all complaint counts |
| `BUCKET_WEIGHTS` | all `1` | Change a bucket's influence here, never by padding its type list |
| `BAND_THRESHOLDS` | good ≥70, fair ≥40, else poor | Inclusive lower bounds |
| `SCORE_ANCHOR_PERCENTILES` | median→50, p90→90 | Where the baseline's two real data points sit on the percentile curve |
| `SCORE_TAIL_MULTIPLIER` | 2 | Curve reaches 100 at `p90 + 2×(p90−median)` |
| `SCORE_DEGENERATE_SPAN` | 10 | For a bucket whose median *and* p90 are both 0, one complaint is already unusual — curve reaches 100 at this count |
| `LOW_CONFIDENCE_BUCKETS` | `{ streetCondition: "high_null_geocoding_rate" }` | ~25.6% of `Street Condition` rows have no geocode, non-uniformly by borough |

### Socrata client & complaints endpoint

| Constant | Value |
|---|---|
| `SOCRATA_TIMEOUT_MS` | 5000 |
| `SOCRATA_MAX_RETRIES` | 2 |
| `SOCRATA_ROW_LIMIT` | 50000 (count queries) |
| `COMPLAINTS_DEFAULT_LIMIT` / `COMPLAINTS_MAX_LIMIT` | 1000 / 5000 (point queries) |

### Cache & baseline

| Constant | Value |
|---|---|
| `CACHE_COLLECTION` | `complaint_cache` |
| `CACHE_COORD_PRECISION` | 4 decimals (~11m) |
| `CACHE_TTL_SECONDS` | 24h |
| `BASELINE_COLLECTION` / `BASELINE_ID` | `baseline` / `"v1"` |
| `BASELINE_SAMPLE_SIZE` | 250 coordinates |
| `BASELINE_SAMPLE_SEED` | `20260815` — fixed, so a rerun samples the *same* points and hits cache instead of paying for 500 fresh Socrata calls |
| `BASELINE_THINNING_GRID_DEGREES` | 0.003° (~330m) — points closer than this collapse to one, so one dense block can't dominate the sample |
| `BASELINE_MIN_BOROUGH_SHARE` | 0.08 — floor so Staten Island isn't drowned out by Brooklyn/Queens volume |

### Input validation

`NYC_BOUNDS`: `lat 40.4–40.95`, `lng -74.3 to -73.7`. Anything outside is a
`400 out_of_bounds`.

---

## `scripts/` — offline tooling

Run with `npm run <script>` (each loads `.env` via Node's built-in
`--env-file-if-exists` flag, no `dotenv` dependency needed).

### `buildBaseline.js` (`npm run baseline`)

Computes the citywide baseline `scoring.js` compares every score against.
High level: pick a deterministic, borough-balanced, spatially-thinned sample
of ~250 coordinates *per tier* (building-tier samples come only from
HPD building-interior complaint types; block-tier from all types — mixing
these was a real bug caught in M4, see `backend/CLAUDE.md` item 6), fetch
real counts for each sample point, then compute `median`, `p90`, `zeroShare`,
`mean`, `max`, and `n` per bucket. Writes the result to the `baseline` Mongo
collection **and** to the committed `src/config/baseline.json`, so the file
always reflects the last real baseline run even if Mongo isn't available
later.

### `verifyDataset.js` (`npm run verify:dataset`)

One-off checks against the *live* Socrata dataset: confirms the dataset
identity/title, the geo column name, and measures the null-geocoding rate per
bucket. This is how the `streetCondition` 25.6% null-geocode finding
(`backend/CLAUDE.md` open item 3) was originally measured — rerun it any time
NYC changes the dataset shape.

### `verifyCache.js` (`npm run verify:cache`)

Exercises the Mongo cache read/write path against a real (or in-memory)
Mongo instance outside of the test suite, for manual sanity-checking.

### `verifyScoring.js` (`npm run verify:scoring`)

Sanity-checks the scoring curve's behavior (e.g. monotonicity, percentile
placement) against real or synthetic distributions, independent of the
`test/scoring.test.js` fixtures.
