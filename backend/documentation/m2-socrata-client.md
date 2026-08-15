# M2 — P1: Socrata client + live-API verification

**Status:** complete, with two decisions pending
**Covers:** CLAUDE.md open items 2, 3, 4 (and a partial finding on item 5), plus
`src/providers/socrata.js`

## Goal

CLAUDE.md is explicit that open items must be verified against the live API
*before* building on top of them. So this milestone did the verification first,
then wrote the client against confirmed facts rather than assumptions.

## What was built

| File | Role |
| --- | --- |
| `scripts/verifyDataset.js` | Re-runnable check of open items 2-4 |
| `src/providers/socrata.js` | `fetchCountsForTier`, `fetchAllCounts`, `fetchComplaints`, `SocrataError` |

`verifyDataset.js` was kept as a committed script rather than a throwaway. The
Socrata dataset has already been re-scoped once under this UID (see item 4); when
scores look wrong six months from now, the first question is "did the dataset
move?" and this answers it in one command.

## Findings

### Item 2 — geo column: RESOLVED

The column is **`location`**, a Point geometry:

```json
"location": { "type": "Point", "coordinates": [-73.855718, 40.850984] }
```

`within_circle(location, 40.7484, -73.9857, 350)` → 36,582 rows. Confirmed.

The sibling `latitude` / `longitude` fields are plain numbers and are **rejected**:

```
query.soql.type-mismatch: Type mismatch for within_circle, is number
```

Worth knowing, because those two fields are the obvious-looking choice and fail
with an error that doesn't immediately point at the fix.

### Item 3 — null geocoding per bucket: RESOLVED, one problem

Trailing 24 months, summed at **bucket** level (per string in `verifyDataset.js` output):

| bucket | n | null geo | |
| --- | ---: | ---: | --- |
| heatHotWater | 651,234 | 0.01% | clean |
| unsanitaryCondition | 247,618 | 0.01% | clean |
| plumbing | 156,235 | 0.04% | clean |
| noise | 1,450,296 | 0.35% | clean |
| parking | 1,514,213 | 0.48% | clean |
| **streetCondition** | **236,517** | **25.60%** | **problem** |

**CLAUDE.md's prediction was inverted.** It guessed "noise and parking usually
well-geocoded; plumbing/unsanitary may be spottier." In fact the HPD building
buckets are the *cleanest* in the dataset (0.01%), and the bucket that fails is
`streetCondition` — which CLAUDE.md did not flag at all.

Drilling in:

- Entirely driven by `Street Condition` (32.64% null, 184,840 rows, **all from DOT**).
  `Sidewalk Condition` is fine at 0.33%.
- **The nulls are geographically skewed**, which is the part that matters:

  | borough | n | null |
  | --- | ---: | ---: |
  | Manhattan | 38,293 | 19.1% |
  | Brooklyn | 63,922 | 19.9% |
  | Staten Island | 19,743 | 26.9% |
  | Bronx | 25,133 | 28.2% |
  | Queens | 89,227 | 31.1% |

  A *uniform* undercount would be harmless — the baseline is computed from the
  same biased data, so percentiles would cancel it out. A 19%→31% spread does
  not cancel: it systematically flatters Queens and the Bronx relative to
  Manhattan on street condition.

- A fallback exists but is not hackathon-scoped: 60,155 of the 60,422
  null-location rows (99.6%) still carry `incident_address`. Only 43 have state-plane
  x/y. So recovering them means geocoding ~60k addresses.

**Decision pending — see handoff.md.**

### Item 4 — dataset identity: RESOLVED

| | |
| --- | --- |
| title | **311 Service Requests from 2020 to Present** (previously "from 2010") |
| range | 2020-01-01 → present, updated daily (last update 2026-08-15) |
| columns | 48 |

Our trailing 24-month window sits comfortably inside the available range. But the
floor is real: a window longer than ~68 months would silently truncate rather
than error. Noted in `constants.js` territory as a constraint on `WINDOW_MONTHS`.

### Item 5 — building radius: partial finding

Not owned by this milestone (Person 3 owns radius tuning), but the smoke test
surfaced something that changes the integration contract.

First smoke test returned **all zeros for Building Health at every location**:

```
Empire State Bldg   building(25m): {heatHotWater:0, unsanitaryCondition:0, plumbing:0}
Bushwick            building(25m): {heatHotWater:0, unsanitaryCondition:0, plumbing:0}
```

The client was not broken. The test coordinates were arbitrary points I picked off
a map — they landed mid-street. Re-running with coordinates taken from **real 311
records** (i.e. actual building points, which is what Google Places returns for a
residential address):

```
1040B EAST 217 STREET, BRONX
    25m:  {heatHotWater:6393, unsanitaryCondition:96, plumbing:161}
    50m:  {heatHotWater:6402, unsanitaryCondition:99, plumbing:162}
   100m:  {heatHotWater:6413, unsanitaryCondition:107, plumbing:164}
```

So 25m is a good radius — it captures the building and bleeds <1% versus 50m.

**But the failure mode is dangerous and worth stating plainly:** an imprecise
coordinate does not produce an error or an obviously-broken number. It produces
*zero complaints*, which scores as a **perfect building**. A renter would be shown
a clean bill of health for a building we simply failed to look up.

Mitigation is a frontend contract: Places must return rooftop-precision
coordinates, not street-interpolated ones. There is also a backend-side guard
worth considering — see next steps.

Separately, some bleed does exist on dense blocks (225 Central Park North returns
2,427 heat complaints at 25m while the address itself accounts for 1,450), which
confirms the concern CLAUDE.md raised in item 5.

## Client design decisions

1. **Two HTTP calls per address, issued in parallel.** `fetchAllCounts` runs the
   building and block tier queries with `Promise.all`. CLAUDE.md specifies two
   calls, not six or twelve; parallel makes the latency the max of the two rather
   than the sum.

2. **Bucket summing happens in the provider, not the service.** `fetchCountsForTier`
   returns `{heatHotWater: 6393, ...}` — already summed via `TYPE_TO_BUCKET`.
   There is no code path that exposes per-string counts to scoring, so CLAUDE.md's
   critical weighting rule cannot be violated downstream by accident.

3. **Counts are zero-filled before summing.** A bucket with no complaints returns
   *no row at all* from Socrata, not a zero row. Without pre-filling, that bucket
   would be `undefined` and become `NaN` in the scoring mean.

4. **Retry only on 429 and 5xx.** A malformed SoQL query returns 400 and will fail
   identically on all three attempts — retrying it just delays the error by ~1.2s
   and burns rate limit.

5. **Backoff is jittered** (`300ms × 3^n × (0.5 + random)`). Under a demo-day
   thundering herd, unjittered retries resynchronize on the same tick and re-trigger
   the throttle they were backing off from.

6. **The app token is read at call time, not at import.** `process.env.SOCRATA_APP_TOKEN`
   is looked up inside `query()`, so the token can be supplied later without the
   module having been imported before `.env` loaded. Requests work without it —
   just throttled — which keeps the whole client usable before credentials arrive.

7. **`SocrataError` is a distinct class** so M6's "serve stale cache when the live
   API fails" can catch precisely the upstream failures and not mask genuine bugs.

## Verification

Live calls against three locations of deliberately different character:

| location | noise | parking | streetCondition |
| --- | ---: | ---: | ---: |
| Empire State Bldg (Midtown) | 1,477 | 1,150 | 329 |
| Bushwick, BK | 1,653 | 899 | 113 |
| Todt Hill, SI (quiet) | 19 | 82 | 38 |

Block Quality separates a loud block from a quiet one by ~80x on noise, which is
the discrimination the score needs.

`fetchComplaints` returns well-formed heatmap points with real coordinates,
types, dates, and status.

**Latency note:** the first call to a given query shape took **11s** end-to-end,
versus **180ms–1.4s** for repeat calls — Socrata appears to cache query shapes
server-side. Note that 11s exceeds our 5s timeout; since the call did ultimately
succeed, the elapsed time is consistent with two 5s attempts timing out and the
third succeeding (the timeout is per attempt, not per `fetchCountsForTier` call).
Worth confirming under load, and a strong argument for M6's cache pre-warming —
the first hit on an uncached demo address is the slow one.
