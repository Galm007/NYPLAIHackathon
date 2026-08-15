/**
 * Computes the citywide baseline the scorer compares every address against.
 *
 *   npm run baseline               # default sample size
 *   npm run baseline -- --samples=80 --dry-run
 *
 * WHY THIS EXISTS: without it we would be showing raw complaint counts, and "47
 * noise complaints" is meaningless to a renter. The baseline turns a count into
 * "quieter than 78% of NYC", which is a defensible score. CLAUDE.md: do not skip.
 *
 * WHAT IT DOES
 *   1. Draws sample coordinates from REAL 311 records, spread across the five
 *      boroughs and thinned so no single dense block dominates.
 *   2. Calls getCounts() on each (cache-first, so a rerun is nearly free).
 *   3. Takes median + p90 per bucket per tier.
 *   4. Writes src/config/baseline.json (COMMIT IT) and, if Mongo is configured,
 *      the `baseline` document.
 *
 * EACH TIER IS SAMPLED SEPARATELY, and that matters more than it looks.
 *
 * Sampling coordinates must come from 311 records, NOT points picked off a map:
 * M2 established that a mid-street coordinate returns ZERO building complaints,
 * so a map-sampled baseline would put the building median at 0 and score every
 * real building as poor.
 *
 * But drawing BUILDING-tier points from all complaint types has the same
 * problem in miniature. Illegal Parking and Street Condition geocode to street
 * locations, not buildings; the first version of this script sampled both tiers
 * from one pooled draw and 36.5% of the resulting points had zero complaints in
 * every building bucket. Those street points pushed the building median down to
 * ~1, so genuine residential buildings were scored against a distribution that
 * was mostly not buildings — systematically telling renters a building was
 * worse than its real peers.
 *
 * So: building-tier points are drawn only from HPD building-interior complaints
 * (heat, plumbing, unsanitary), which are always residential building
 * addresses. Block-tier points are drawn from every type, which is what a block
 * actually is. Cost is unchanged — one tier per point instead of two.
 *
 * RESIDUAL BIAS — read before trusting the numbers. Points are still drawn from
 * locations that generated at least one 311 complaint, so a building nobody has
 * ever complained about cannot be sampled. That biases the baseline HIGH
 * (toward complaint-generating locations), making real scores slightly generous
 * rather than harsh. Fixing it properly needs a building-footprint dataset
 * (PLUTO) and is not hackathon-scoped.
 */

import { writeFile } from "node:fs/promises";
import {
  ALL_COMPLAINT_TYPES,
  BUILDING_HEALTH_TYPES,
  BASELINE_ID,
  BASELINE_MIN_BOROUGH_SHARE,
  BASELINE_SAMPLE_CONCURRENCY,
  BASELINE_SAMPLE_SEED,
  BASELINE_SAMPLE_SIZE,
  BASELINE_THINNING_GRID_DEGREES,
  BOROUGHS,
  BUCKET_NAMES,
  LOCATION_FIELD,
  RADIUS_TIERS,
  WINDOW_MONTHS,
  windowCutoffISO,
} from "../src/config/constants.js";
import { query } from "../src/providers/socrata.js";
import { getCounts } from "../src/services/scoreService.js";
import { ensureCacheIndexes } from "../src/providers/cache.js";
import { closeMongo, isMongoConfigured } from "../src/providers/mongo.js";
import { saveBaseline, BASELINE_FILE_PATH } from "../src/providers/baseline.js";

// --- args --------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  })
);

const SAMPLE_SIZE = Number(args.samples) || BASELINE_SAMPLE_SIZE;
const DRY_RUN = args["dry-run"] === "true";
// Oversample before thinning: dense boroughs lose a lot of points to the grid.
const OVERSAMPLE = 6;
const CHUNKS_PER_BOROUGH = 5;
const CHUNK_WINDOW_DAYS = 21;
const SAMPLING_TIMEOUT_MS = 30000;

// --- deterministic RNG -------------------------------------------------------

/** Mulberry32. Seeded so a rerun samples the SAME points and hits the cache. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seededRandom(BASELINE_SAMPLE_SEED);

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- SoQL helpers ------------------------------------------------------------

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const typeInClause = (types) =>
  `complaint_type in (${types.map(quote).join(",")})`;
const CUTOFF = windowCutoffISO();

/**
 * Where each tier's sample coordinates come from. See the header: building
 * points must be actual buildings, so they are drawn from HPD's
 * building-interior complaints only. Block points are drawn from everything.
 */
const SAMPLE_SOURCES = {
  building: {
    label: "HPD building-interior complaints",
    types: Object.values(BUILDING_HEALTH_TYPES).flat(),
  },
  block: {
    label: "all complaint types",
    types: ALL_COMPLAINT_TYPES,
  },
};

// --- step 1: borough quotas --------------------------------------------------

/**
 * Quotas proportional to each borough's share of the relevant 311 records, with
 * a floor. Pure proportional sampling would nearly erase Staten Island and the
 * baseline would describe dense Brooklyn/Queens instead of the city; pure equal
 * sampling would over-represent it. The floor is the compromise.
 */
async function boroughQuotas() {
  const rows = await query(
    {
      $select: "borough, count(*) AS count",
      $where: [
        typeInClause(ALL_COMPLAINT_TYPES),
        `created_date > ${quote(CUTOFF)}`,
      ].join(" AND "),
      $group: "borough",
    },
    { timeoutMs: SAMPLING_TIMEOUT_MS }
  );

  const counts = new Map(
    rows
      .filter((row) => BOROUGHS.includes(row.borough))
      .map((row) => [row.borough, Number(row.count)])
  );
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  // Floor first, then hand the remainder out proportionally.
  const floorShare = BASELINE_MIN_BOROUGH_SHARE;
  const remaining = 1 - floorShare * BOROUGHS.length;
  const quotas = BOROUGHS.map((borough) => {
    const share = total === 0 ? 1 / BOROUGHS.length : (counts.get(borough) ?? 0) / total;
    return [borough, Math.max(1, Math.round(SAMPLE_SIZE * (floorShare + remaining * share)))];
  });

  console.log("=== Borough quotas ===");
  for (const [borough, quota] of quotas) {
    const share = total === 0 ? 0 : ((counts.get(borough) ?? 0) / total) * 100;
    console.log(
      `  ${borough.padEnd(14)} ${String(quota).padStart(4)} points` +
        `   (${share.toFixed(1)}% of records)`
    );
  }
  return quotas;
}

// --- step 2: candidate coordinates ------------------------------------------

/**
 * Pulls candidate coordinates for one borough from several random slices of the
 * time window rather than one contiguous page. Deep `$offset` paging is slow on
 * a dataset this size, and a single page would be one moment in time; random
 * date slices are cheap and spread the sample temporally as well as spatially.
 */
async function candidateCoords(borough, wanted, types) {
  const cutoffMs = new Date(`${CUTOFF}Z`).getTime();
  const windowMs = Date.now() - cutoffMs;
  const sliceMs = CHUNK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const perChunk = Math.ceil((wanted * OVERSAMPLE) / CHUNKS_PER_BOROUGH);

  const coords = [];
  for (let chunk = 0; chunk < CHUNKS_PER_BOROUGH; chunk++) {
    const start = cutoffMs + rand() * Math.max(0, windowMs - sliceMs);
    const startISO = new Date(start).toISOString().slice(0, 19);
    const endISO = new Date(start + sliceMs).toISOString().slice(0, 19);

    const rows = await query(
      {
        $select: "latitude, longitude",
        $where: [
          `borough = ${quote(borough)}`,
          typeInClause(types),
          `created_date between ${quote(startISO)} and ${quote(endISO)}`,
          // within_circle already ignores null-geo rows; be explicit here so a
          // null coordinate can never become a sample point.
          `${LOCATION_FIELD} IS NOT NULL`,
        ].join(" AND "),
        // Deliberately UNORDERED. `$order=unique_key` on this filter measured
        // 9.7s against 0.23s unordered — it sorts the whole matched set — and
        // blew the sampling timeout. Reproducibility comes from the seeded date
        // slices, not from ordering.
        $limit: String(perChunk),
      },
      { timeoutMs: SAMPLING_TIMEOUT_MS }
    );

    for (const row of rows) {
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push({ lat, lng });
    }
  }
  return coords;
}

/**
 * Keeps at most one point per ~330m grid cell. Without this, a single
 * complaint-heavy building contributes dozens of near-identical points and
 * drags the median toward its own numbers.
 */
function thin(coords) {
  const grid = BASELINE_THINNING_GRID_DEGREES;
  const seen = new Set();
  const kept = [];
  for (const coord of coords) {
    const cell = `${Math.round(coord.lat / grid)}:${Math.round(coord.lng / grid)}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    kept.push(coord);
  }
  return kept;
}

async function buildSample(quotas, tier) {
  const { label, types } = SAMPLE_SOURCES[tier];
  const sample = [];

  console.log(`\n=== Sampling ${tier}-tier coordinates from ${label} ===`);
  for (const [borough, quota] of quotas) {
    const candidates = await candidateCoords(borough, quota, types);
    const thinned = thin(candidates);
    const picked = shuffle(thinned).slice(0, quota);
    sample.push(...picked.map((coord) => ({ ...coord, borough })));
    console.log(
      `  ${borough.padEnd(14)} ${String(candidates.length).padStart(5)} candidates` +
        ` -> ${String(thinned.length).padStart(4)} after thinning` +
        ` -> ${String(picked.length).padStart(4)} sampled`
    );
  }
  return sample;
}

// --- step 3: counts ----------------------------------------------------------

/** Bounded-concurrency map. Two HTTP calls per point — do not flood Socrata. */
async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await worker(items[current], current);
      }
    })
  );
  return results;
}

async function collectCounts(sample, tier) {
  console.log(
    `\n=== Counting ${tier} complaints at ${sample.length} points ` +
      `(${BASELINE_SAMPLE_CONCURRENCY} at a time, cache-first) ===`
  );

  let done = 0;
  let failed = 0;
  const started = performance.now();

  const results = await mapWithConcurrency(
    sample,
    BASELINE_SAMPLE_CONCURRENCY,
    async (point) => {
      try {
        // One tier per point, not both: each tier has its own sample, so
        // fetching the other one here would be a wasted HTTP call.
        const { counts } = await getCounts(point.lat, point.lng, { tiers: [tier] });
        return counts[tier];
      } catch (err) {
        failed++;
        if (failed <= 3) console.warn(`  warn: ${err.message.slice(0, 120)}`);
        return null;
      } finally {
        done++;
        if (done % 25 === 0 || done === sample.length) {
          const elapsed = (performance.now() - started) / 1000;
          console.log(
            `  ${String(done).padStart(4)}/${sample.length}` +
              `  ${elapsed.toFixed(0)}s elapsed, ${failed} failed`
          );
        }
      }
    }
  );

  const usable = results.filter(Boolean);

  // A baseline built from a handful of surviving points is worse than no
  // baseline: it would look authoritative and be noise. Refuse instead.
  if (usable.length < sample.length * 0.7) {
    throw new Error(
      `only ${usable.length}/${sample.length} points returned counts — ` +
        `Socrata is probably degraded. Not writing a baseline from this.`
    );
  }
  return usable;
}

// --- step 4: percentiles -----------------------------------------------------

/**
 * Nearest-rank percentile on the sorted sample: p(k) is the smallest value at
 * or above which k% of the sample sits. No interpolation — with heavily
 * zero-inflated buckets, interpolating between ranks invents values the data
 * never contained.
 */
function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  const rank = Math.ceil(fraction * sortedValues.length);
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, rank - 1))];
}

function summarize(countsByTier) {
  const perBucket = {};
  const perTierSamples = {};

  for (const [tier, buckets] of Object.entries(BUCKET_NAMES)) {
    const countsList = countsByTier[tier];
    perTierSamples[tier] = countsList.length;
    for (const bucket of buckets) {
      const values = countsList
        .map((counts) => counts?.[bucket])
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      perBucket[bucket] = {
        median: percentile(values, 0.5),
        p90: percentile(values, 0.9),
        // zeroShare is READ BY THE SCORER (these buckets are heavily
        // zero-inflated — half of NYC has no plumbing complaints, so the curve
        // needs to know how wide the zero tie is). mean/max/n are diagnostics
        // that tell you at a glance whether a bucket's baseline is degenerate.
        mean: values.length
          ? Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(2))
          : 0,
        max: values.length ? values[values.length - 1] : 0,
        zeroShare: values.length
          ? Number((values.filter((n) => n === 0).length / values.length).toFixed(3))
          : 1,
        n: values.length,
      };
    }
  }
  return { perBucket, perTierSamples };
}

// --- run ---------------------------------------------------------------------

if (!process.env.SOCRATA_APP_TOKEN) {
  console.warn("WARNING: SOCRATA_APP_TOKEN unset — expect throttling\n");
}

if (isMongoConfigured()) {
  // Not awaited-critical, but the sample is about to issue hundreds of cache
  // reads; having the index in place first keeps them from being collection scans.
  await ensureCacheIndexes().catch((err) =>
    console.warn("[baseline] index setup failed, continuing:", err.message)
  );
} else {
  console.warn(
    "NOTE: MONGODB_URI unset — no cache, so every point costs a live call " +
      "and a rerun will not be free.\n"
  );
}

const quotas = await boroughQuotas();

const countsByTier = {};
for (const tier of Object.keys(RADIUS_TIERS)) {
  const sample = await buildSample(quotas, tier);
  countsByTier[tier] = await collectCounts(sample, tier);
}

const { perBucket, perTierSamples } = summarize(countsByTier);

const doc = {
  _id: BASELINE_ID,
  perBucket,
  // A baseline is only valid for the radii it was sampled at. Recorded so the
  // scorer can detect a retuned radius instead of silently shifting every score.
  radiusMeters: Object.fromEntries(
    Object.entries(RADIUS_TIERS).map(([tier, { radiusMeters }]) => [tier, radiusMeters])
  ),
  windowMonths: WINDOW_MONTHS,
  // Each tier has its own sample drawn from its own source — see the header.
  sampleSize: Math.min(...Object.values(perTierSamples)),
  sampleRequested: SAMPLE_SIZE,
  perTierSamples,
  sampleSources: Object.fromEntries(
    Object.entries(SAMPLE_SOURCES).map(([tier, { label }]) => [tier, label])
  ),
  computedAt: new Date().toISOString(),
};

console.log("\n=== Baseline ===");
console.log(
  `  ${"bucket".padEnd(20)} ${"median".padStart(7)} ${"p90".padStart(7)}` +
    ` ${"mean".padStart(8)} ${"max".padStart(7)} ${"zero%".padStart(7)}`
);
for (const [tier, buckets] of Object.entries(BUCKET_NAMES)) {
  console.log(
    `  -- ${tier} (${RADIUS_TIERS[tier].radiusMeters}m, ` +
      `n=${perTierSamples[tier]} from ${SAMPLE_SOURCES[tier].label})`
  );
  for (const bucket of buckets) {
    const stats = perBucket[bucket];
    console.log(
      `  ${bucket.padEnd(20)} ${String(stats.median).padStart(7)}` +
        ` ${String(stats.p90).padStart(7)} ${String(stats.mean).padStart(8)}` +
        ` ${String(stats.max).padStart(7)} ${(stats.zeroShare * 100).toFixed(0).padStart(6)}%`
    );
  }
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
} else {
  await writeFile(BASELINE_FILE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`\nWrote ${BASELINE_FILE_PATH} — COMMIT THIS FILE.`);

  const savedToMongo = await saveBaseline(doc);
  console.log(
    savedToMongo
      ? `Wrote baseline document _id="${BASELINE_ID}" to Mongo.`
      : "Mongo not written (unconfigured or unreachable) — the committed file is enough to serve scores."
  );
}

await closeMongo();
console.log(
  `\nDone: ${Object.entries(perTierSamples)
    .map(([tier, n]) => `${n} ${tier}`)
    .join(", ")} points, ${WINDOW_MONTHS}-month window.`
);
