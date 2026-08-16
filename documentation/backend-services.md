# Backend — Services (`backend/src/services/`)

## `scoreService.js` — orchestration

The only layer that coordinates cache + Socrata + baseline + scoring. Routes
call into this; this never touches Express, and providers never call each
other directly except through here.

### `getCounts(lat, lng, { now, tiers, forceRefresh })`

Bucket counts for both radius tiers around one point.

1. Rounds the coordinate to the cache-key precision (`roundCoord`, ~11m).
   **The rounded coordinate is what's queried**, not the raw one — otherwise
   two nearby addresses sharing a cache key could get whichever circle
   happened to be queried first, and a cache hit vs. miss would silently
   describe different circles.
2. Reads whatever's cached for the requested tiers (`providers/cache.js`).
3. For tiers that missed, calls `providers/socrata.js#fetchCountsForTier()` in
   parallel via `Promise.allSettled` — a rejection in one tier doesn't discard
   a successful write in the other (`Promise.all` would have).
4. Writes each fetched tier back to the cache (awaited, not fire-and-forget —
   an unawaited rejection can surface as an unhandled rejection and kill a
   serverless process before the write lands).
5. Returns `{ coord, counts: {building, block}, cache: {building: "hit"|"miss", block: "hit"|"miss"} }`.

### `buildScoreReport(lat, lng, options)`

The full `POST /api/score` payload.

- `isMockMode()` → `mockData.js#mockScoreReport()`, no network at all.
- Otherwise: `getCounts()` and `loadBaseline()` run **in parallel** (the
  baseline load is memoized and usually free, but on a cold process it's a
  Mongo round trip with no reason to sit behind two sequential HTTP calls),
  then both feed into `scoring.js#buildReport()`.

### `fetchComplaintPoints(lat, lng, radiusMeters, options)`

Backs `GET /api/complaints`. **Not cached** — the cache stores bucket counts,
not individual rows, and caching thousands of points per coordinate is
exactly the "bulk ingest" pattern the project avoids. Reports whether the
result was truncated by the row cap (see
[`backend-routes.md`](./backend-routes.md#get-apicomplaints---complaintsjs)).

### `isMockMode()`

`true` when `USE_MOCK_DATA` is `"1"` or `"true"`. Read at *call time*, not
import time, so tests (or a live process) can flip it without re-importing
the module. Mock mode stays in the codebase permanently — it's how the
frontend gets developed with zero Socrata token, zero Mongo, zero network.

---

## `scoring.js` — the scoring algorithm (pure function)

No network, no Mongo, no clock — everything here is a function of its
arguments. This is deliberate: it means the whole scoring model is testable
against fixed fixtures, and it's the one file where "is this number right"
can be answered without hitting a live API.

### Why percentile-against-a-baseline, not raw counts

> "47 noise complaints" means nothing to a renter. "Quieter than 78% of NYC"
> does.

Each bucket's raw count is converted to *where it sits in the citywide
distribution* for that bucket, then inverted (fewer complaints = higher
score). That's what the baseline (`median`, `p90`, `zeroShare` per bucket —
see [`backend-providers.md`](./backend-providers.md#baselinejs)) is for.

### The percentile curve — `anchorsFor()` + `percentileFor()`

For one bucket, four anchor points `[count, percentile]` define a
piecewise-linear curve:

1. **`[0, 0]`** — zero complaints is always the best possible reading for
   that anchor set (before the zero-tie adjustment below).
2. **The zero-tie ceiling** — complaint counts are small integers over a
   heavily zero-inflated distribution (e.g. ~45% of sampled buildings have
   zero heat complaints). All of those buildings are *tied* at "zero," and
   ties resolve to the **most favorable** percentile in the tie — otherwise a
   zero count would inherit the tie's median and score ~50 instead of 100.
   `zeroShare` anchors `[1, zeroShare × 100]`, so the *first* complaint above
   zero starts scoring from the top of that tie, not from the middle of it.
3. **`[median, 50]`** and **`[p90, 90]`** — the two real data points from the
   baseline.
4. **The tail** — above `p90` the baseline says nothing about shape, so the
   curve extrapolates to `100` at `p90 + 2×(p90 − median)`. The multiplier of
   2 (`SCORE_TAIL_MULTIPLIER`) exists specifically so a genuinely awful
   location doesn't flatten to the same score as a merely bad one.

`normalizeAnchors()` sorts these, collapses ties to their lowest percentile,
and drops any point that would make the curve **non-monotonic** — without
that guard, a bucket whose median sits below its own zero-tie ceiling could
produce a curve where *more* complaints score *better*.

`percentileFor(count, baseline)` then does simple linear interpolation
between whichever two anchors bracket `count`. `bucketScore()` inverts it:
`100 − percentile`, clamped to `[0, 100]`.

### Aggregating buckets → one sub-score

`aggregate()` is a weighted mean of the three bucket scores per tier (weights
all `1` today, via `BUCKET_WEIGHTS` — see
[`backend-config-and-scripts.md`](./backend-config-and-scripts.md) for why a
bucket's *weight* is the place to change its influence, never its list of
complaint-type strings).

### `scoreTier(tierName, counts, baseline)`

Puts it together for one tier (`"building"` or `"block"`):

- Zero-fills any missing bucket (defends against `NaN` poisoning the mean).
- Computes each bucket's score, then the aggregate `score` and its `band`
  (`bandFor()`: `≥70` good, `≥40` fair, else poor).
- Determines **confidence**, checked in priority order (most-undermining
  reason wins):

  <a name="confidence"></a>

  | Condition | `confidence` | `confidenceReason` |
  |---|---|---|
  | No baseline available at all | `low` | `no_baseline` |
  | Baseline was sampled at different radii than currently configured | `low` | `stale_baseline_radius` |
  | Every bucket in the tier is exactly zero | `low` | `no_complaints_found` |
  | otherwise | `normal` | `null` |

  The all-zero case matters a lot in practice: a mid-street coordinate (not
  rooftop-precise) returns **zero** building complaints, which without this
  flag would present as a *perfect* building — a lookup failure disguised as
  good news. See `backend/CLAUDE.md` open item 5.

- `bucketConfidence` lists only non-normal buckets (so `{}` means "all
  solid"). Currently only `streetCondition` is ever flagged
  (`LOW_CONFIDENCE_BUCKETS`), because ~25.6% of `Street Condition` 311 records
  have no geocode, and the null rate isn't uniform across boroughs (19.1%
  Manhattan → 31.1% Queens), so it doesn't cancel out against the baseline.

### `buildReport(counts, baseline, meta)`

Assembles the full response: `address: null` (this API never geocodes),
`buildingHealth` and `blockQuality` from `scoreTier()`, and `meta` (window,
baseline version/source, plus whatever the caller passes through — cache hit
status, the rounded coordinate).

---

## `mockData.js` — offline mode

Opt-in via `USE_MOCK_DATA=1`. Generates **counts only** and hands them to the
*real* `scoring.js#buildReport()` — the mock and the live path diverge in
exactly one place (where the counts came from), so the mock can never drift
out of shape with the real response contract.

- Counts are **derived from the coordinate** (FNV-1a hash → seeded PRNG), not
  random — the same address always returns the same report, which matters a
  lot for eyeballing frontend layout during development.
- Skewed toward low counts (`rand() ** 2.5`) to mimic 311's real long-tailed
  distribution — a uniform draw against a realistic baseline would almost
  never produce a "good" band, and the frontend would never see that state.
- Ships its own `MOCK_BASELINE` (plausible order-of-magnitude numbers, not
  the real citywide one) so mock mode needs zero files, zero Mongo, zero
  network.
- `mockComplaints()` scatters synthetic points uniformly inside the requested
  circle (`sqrt(rand())` for uniform-over-disc, not clumped at the center)
  for the `/api/complaints` mock path.
