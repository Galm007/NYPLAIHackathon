# M4 + M5 — P3/P4: baseline, pure scoring, and the swap to real data

**Status:** complete. `/api/score` and `/api/complaints` now serve live NYC 311
data scored against a committed citywide baseline. The mock is opt-in.
**Covers:** `src/services/scoring.js`, `src/providers/baseline.js`,
`src/config/baseline.json`, `scripts/buildBaseline.js`, `scripts/verifyScoring.js`,
and the route/service wiring.

M4 and M5 were done together because they are one change from the frontend's
point of view: until the scorer exists there is nothing real to swap the mock
for, and until the swap happens the scorer is untested against real counts.

## Goal

Turn "47 noise complaints" into "quieter than 78% of NYC" — and then actually
serve it.

## What was built

| File | Role |
| --- | --- |
| `src/services/scoring.js` | `percentileFor`, `bucketScore`, `scoreTier`, `buildReport` — pure |
| `src/providers/baseline.js` | Loads the baseline: Mongo first, committed JSON second |
| `src/config/baseline.json` | **The committed baseline artifact.** Keep it in git |
| `scripts/buildBaseline.js` | Samples NYC, computes median/p90/zeroShare, writes both copies |
| `scripts/verifyScoring.js` | `npm run verify:scoring` — does the score discriminate? |
| `src/services/scoreService.js` | `buildScoreReport`, `fetchComplaintPoints`, `isMockMode` |
| `src/routes/score.js` | Real scores, unchanged response shape |
| `src/routes/complaints.js` | Real points + truncation headers |
| `test/baseline.test.js` | Baseline validation, Mongo/file precedence (17 tests) |
| `test/scoring.test.js` | The scoring maths against fixtures (31 tests) |

**209 tests, all passing, still no network in any of them** (was 135 after M3).

## How the score is computed

```
raw count -> percentile vs citywide baseline -> invert -> mean of 3 -> band
```

Per bucket, the baseline supplies three points of the citywide distribution —
`median`, `p90`, and `zeroShare` — and the count is placed on a
piecewise-linear curve through them:

| count | percentile | score |
| --- | --- | --- |
| 0 | 0 | 100 |
| 1 | `zeroShare × 100` | the rest of the zero tie |
| median | 50 | 50 |
| p90 | 90 | 10 |
| p90 + 2×(p90−median) | 100 | 0 |

The three bucket scores are averaged through `BUCKET_WEIGHTS` (all 1 today, so a
plain mean) and mapped to a band at the existing thresholds.

### Why zeroShare is in there

These buckets are heavily zero-inflated — 14% of sampled buildings have no
plumbing complaints at all. Without `zeroShare` the curve interpolates between
"0 complaints" and "median complaints" as if the intervening values were
evenly spread, so the first complaint reads as barely worse than none. Anchoring
count 1 at the top of the zero tie says the true thing: having one puts you
behind everyone who has none.

### Why ties resolve to the favourable end

A count of 0 spans a wide percentile range whenever a bucket is zero-inflated.
We report the bottom of that range, so **zero complaints always scores 100**.

This was not the first implementation. The original collapsed tied anchors to
the *highest* percentile, which meant a bucket whose median was 0 (plumbing, in
the first baseline) scored a zero count as 50 — "you have no plumbing
complaints, that's average". It was caught by a live mid-street lookup returning
83 instead of 100, not by a unit test; there is now a regression test for it.

The risk of always scoring 0 as 100 is the mid-street coordinate that finds
nothing and looks perfect. That is handled by the confidence marker below, not
by distorting the curve.

## The baseline

`npm run baseline` samples ~250 coordinates per tier, calls the real
`getCounts` on each (cache-first, so a rerun is nearly free), and writes
`src/config/baseline.json` plus a Mongo document.

### Each tier is sampled from its own source — the important finding

The first baseline drew both tiers from one pooled sample of all our complaint
types. `npm run verify:scoring` then reported that **36.5% of building-tier
points had zero complaints in every building bucket**.

The cause: Illegal Parking and Street Condition complaints geocode to *street*
locations, not buildings. Roughly a third of the pooled sample was not buildings
at all. Those street points dragged the building median down to ~1, so real
residential buildings were being scored against a distribution that was mostly
not buildings — systematically telling renters a building was worse than its
actual peers.

Fixed by drawing building-tier points only from HPD building-interior complaints
(heat/hot water, plumbing, unsanitary condition), which are always residential
building addresses. Block-tier points still come from all types, which is what a
block is. Cost is unchanged: one tier per point instead of two.

The correction is large:

| bucket | pooled sample (wrong) | per-tier sample (committed) |
| --- | --- | --- |
| heatHotWater | median 1, p90 72, 45% zero | **median 30, p90 245, 6% zero** |
| unsanitaryCondition | median 1, p90 25, 46% zero | **median 12, p90 54, 6% zero** |
| plumbing | median 0, p90 17, 53% zero | **median 7, p90 34, 14% zero** |

Block-tier numbers barely moved (noise median 916 → 1121), as expected — that
tier's sampling never changed.

Concretely: a Bushwick building with 5 heat and 1 plumbing complaint scored
**67 ("fair")** against the pooled baseline and scores **91 ("good")** against
the corrected one. The second is right — an NYC apartment building generates
dozens of heat complaints over two years, so five is genuinely low.

### Sampling method

- **Coordinates come from real 311 records, never picked off a map.** M2
  established that a mid-street point returns zero building complaints; a
  map-sampled baseline would put the building median at 0 and score every real
  building as poor.
- **Borough quotas are proportional to record share with an 8% floor.** Pure
  proportional sampling nearly erases Staten Island (2.6% of records); pure
  equal sampling over-represents it.
- **Thinned to one point per ~330m grid cell**, so a single complaint-heavy
  block cannot dominate the distribution.
- **Seeded PRNG (`BASELINE_SAMPLE_SEED`).** A rerun samples the *same*
  coordinates, so it hits the cache instead of paying for 500 fresh calls, and
  two runs are comparable.
- **Random 21-day slices of the window, not deep `$offset` paging.**
  `$order=unique_key` on this filter measured **9.7s against 0.23s unordered** —
  it sorts the whole matched set — and blew the sampling timeout outright.
- **Refuses to write** if fewer than 70% of points return counts. A baseline
  built from the survivors of a degraded API would look authoritative and be noise.

### Residual bias, stated plainly

Sample points are locations that generated at least one 311 complaint, so a
building nobody has ever complained about cannot be sampled. This biases the
baseline **high** (toward complaint-generating locations), which makes real
scores slightly generous rather than harsh. Fixing it properly needs a building
footprint dataset (PLUTO) and is not hackathon-scoped.

### Two storage locations, on purpose

Mongo first, committed `baseline.json` second. The committed copy means the API
produces real scores on a fresh clone with no Mongo and no credentials, and it
means a Mongo outage costs latency rather than turning every score into
`no_baseline`. Mongo wins when present so the baseline can be refreshed without
a redeploy.

A baseline missing even one bucket is rejected wholesale rather than used
partially — a missing bucket would score against `undefined` and quietly hand
out a free 100.

## Contract extensions (all additive)

No existing field changed name, type, or meaning. A frontend that ignores these
keeps working exactly as it did.

```jsonc
{
  "buildingHealth": {
    "score": 91, "band": "good", "counts": {…}, "radiusMeters": 25,  // unchanged
    "confidence": "normal",          // "normal" | "low"
    "confidenceReason": null,        // null when normal
    "bucketScores": { "heatHotWater": 93, … },   // per-bucket 0-100
    "bucketConfidence": {}           // only lists non-normal buckets
  },
  "blockQuality": { …, "bucketConfidence": { "streetCondition": "low" } },
  "meta": {
    "windowMonths": 24,
    "baselineVersion": "v1",
    "baselineSource": "mongo",       // or "file"
    "coord": { "lat": 40.698, "lng": -73.921 },   // the ROUNDED coord we queried
    "cache": { "building": "hit", "block": "hit" }
  }
}
```

`bucketScores` and `meta` are **two more additive fields than handoff.md's
decisions A and B agreed** — they need the same nod from Person 2. `bucketScores`
is there because it is the only way the UI can explain *why* a score is what it
is; `meta` is there for the demo (cache state, which baseline produced the
number).

Three reasons a sub-score is marked low-confidence:

| reason | meaning |
| --- | --- |
| `no_complaints_found` | every bucket is 0 — likely a coordinate that missed its building |
| `no_baseline` | no baseline anywhere; the score is not comparable to the city |
| `stale_baseline_radius` | the baseline was sampled at a different radius than we now query |

The last one exists because retuning `RADIUS_TIERS` without rerunning
`npm run baseline` silently shifts every score. The baseline records the radii it
was built at, and the scorer checks them.

## M5 — what actually changed at the edges

- `/api/score` calls `buildScoreReport`, which loads counts (cache-first) and the
  baseline **in parallel** — on a cold process the baseline read has no reason to
  sit behind two HTTP calls.
- `/api/complaints` serves real Socrata rows.
- **Socrata failure is now a 503 `upstream_unavailable`, not a 500.** The
  frontend can say "NYC's data service is unavailable, try again" off a 503; it
  can say nothing useful off a 500. Socrata was fully dark for hours during M3,
  so this is not hypothetical.
- **Mock mode is opt-in via `USE_MOCK_DATA=1`.** Kept because it is the only way
  to work on the frontend with no token, no Mongo, and no network. It now
  generates *counts only* and runs them through the real scorer, so mock and live
  differ in exactly one place. `meta.mock: true` marks the payload, so nobody
  demos mock numbers believing they are live.

### `/api/complaints` truncation — the M5 decision

The watch item from M3: at the 1000-row cap with `$order created_date DESC`, a
dense block returns only its most recent months (Bushwick at 350m: 1000 rows
covering 148 of 730 days), so the heatmap and the score disagree, and truncation
is uneven between neighbourhoods.

**Decided:** keep the response a bare JSON array (that shape is frozen) and
report truncation in **headers** instead:

```
X-Complaints-Truncated: true|false
X-Complaints-Limit:     1000
```

`Access-Control-Expose-Headers` is set, or browser JS would receive the headers
and be forbidden from reading them. A `limit` query parameter now allows up to
5000 rows for a caller that wants more.

**The frontend must never count from this endpoint.** Counts come from
`/api/score`, which aggregates server-side over the full window.

## Verification

`npm run verify:scoring` re-scores every cached coordinate against the committed
baseline. Unit tests prove the maths; they cannot tell you the scale is *useful*
— a scorer returning "fair" for all of NYC would pass every one of them.

Current output (757 cached coordinates):

| tier | min | p25 | median | p75 | max | bands (good/fair/poor) |
| --- | --- | --- | --- | --- | --- | --- |
| building | 2 | 46 | 73 | 95 | 100 | 274 / 148 / 90 |
| block | 6 | 36 | **49** | 66 | 98 | 107 / 252 / 154 |

The block median of 49 is the headline number: a coordinate at the citywide
median scores ~50, which is exactly what a baseline-centred scale should do. The
building distribution skews high because the cache still contains the ~250
street points from the first (pooled) sampling run, which correctly score near
100 for building health.

Extremes, as a sanity check: worst block 40.7198,-73.9857 scores 6 with 7,049
noise complaints; best scores 98 with 1.

## Things that bit, or nearly did

1. **`$order=unique_key` cost 42× more than no ordering** (9.7s vs 0.23s) and
   timed out the sampler on the first run. Sampling is unordered now.
2. **Zero-count buckets scored 50 instead of 100** when the bucket's median was
   0 — the tie-collapsing rule kept the highest percentile at a duplicated
   count. Found by eyeballing a live mid-street lookup, not by a test.
3. **A third of the building baseline was street corners** (above). Found by
   `verify:scoring` reporting 36.5% low-confidence, which is exactly the kind of
   thing a unit test cannot notice.
4. **The mock stopped producing "good" scores** once it was scored by the real
   scorer, because uniform random counts against a realistic baseline land above
   the median nearly every time. The mock draws are skewed low now
   (`rand() ** 2.5`), which is also closer to how 311 counts really behave.

## What is NOT done

- **No stale-cache fallback during a Socrata outage.** An uncached address
  during an outage returns 503. That is M6, and it interacts with the 24h TTL —
  see handoff.md.
- **No building-size normalisation.** A 200-unit tower and a 4-unit walkup with
  the same per-unit complaint rate do not score the same; the tower scores
  worse. Fixing it needs unit counts from PLUTO.
- **Baseline is not scheduled to refresh.** It is a committed artifact; rerun
  `npm run baseline` if the window or the radii change.
