import {
  RADIUS_TIERS,
  COMPLAINTS_DEFAULT_LIMIT,
  EXPLANATION_SOURCES,
} from "../config/constants.js";
import { fetchCountsForTier, fetchComplaints } from "../providers/socrata.js";
import {
  readEntries,
  writeCounts,
  writeExplanation,
  roundCoord,
} from "../providers/cache.js";
import { loadBaseline } from "../providers/baseline.js";
import { buildReport, scoreTier } from "./scoring.js";
import { explainFromTemplate, explainWithAI } from "./explain.js";
import { mockScoreReport, mockComplaints } from "./mockData.js";

// Orchestration: cache first, Socrata on a miss, write the result back.
// The routes never call Socrata or Mongo directly — that separation is what
// lets this be tested with a fake fetch and an in-memory Mongo.

const ALL_TIERS = Object.keys(RADIUS_TIERS);

/**
 * Bucket counts for both radius tiers around one point.
 *
 * The Socrata query uses the ROUNDED coordinate, not the caller's raw one. If it
 * used the raw coordinate, two addresses sharing a cache key would get whichever
 * circle happened to be queried first — a cache hit and a cache miss would then
 * describe measurably different circles. Rounding first makes the key and the
 * query agree, at the cost of moving the centre by up to ~8m (4dp ≈ 11m, well
 * inside the 25m building radius).
 *
 * Misses are fetched in parallel, so an uncached point still costs the two HTTP
 * calls CLAUDE.md budgets — never more.
 *
 * @returns {Promise<{coord: {lat, lng}, counts: Record<string, object>,
 *   cache: Record<string, "hit"|"miss">}>}
 */
export async function getCounts(lat, lng, { now, tiers = ALL_TIERS, forceRefresh = false } = {}) {
  const coord = { lat: roundCoord(lat), lng: roundCoord(lng) };

  const entries = forceRefresh
    ? Object.fromEntries(tiers.map((tier) => [tier, null]))
    : await readEntries(coord.lat, coord.lng, tiers);

  // Any explanation cached alongside the counts. Returned so the score path can
  // serve a stored AI explanation without ever making an AI call itself.
  const cachedExplanations = Object.fromEntries(
    tiers.map((tier) => [tier, entries[tier] ?? null])
  );

  const cached = Object.fromEntries(
    tiers.map((tier) => [tier, entries[tier]?.counts ?? null])
  );

  const misses = tiers.filter((tier) => cached[tier] === null);

  // allSettled, not all: Promise.all short-circuits on the first rejection, so a
  // failing building tier would abandon the block tier mid-write and throw away
  // a call that had already succeeded. Letting both settle means a retry after a
  // partial failure only pays for the tier that actually failed.
  const settled = await Promise.allSettled(
    misses.map(async (tier) => {
      const counts = await fetchCountsForTier(coord.lat, coord.lng, tier, { now });
      // Awaited, not fire-and-forget: an unawaited rejection would surface as an
      // unhandled rejection, and on serverless the process can exit first.
      // writeCounts never throws, so this cannot fail the request.
      await writeCounts(coord.lat, coord.lng, tier, counts, { now });
      return [tier, counts];
    })
  );

  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (failure) throw failure.reason;

  const counts = {
    ...cached,
    ...Object.fromEntries(settled.map((outcome) => outcome.value)),
  };

  return {
    coord,
    counts,
    cachedExplanations,
    cache: Object.fromEntries(
      tiers.map((tier) => [tier, misses.includes(tier) ? "miss" : "hit"])
    ),
  };
}

/**
 * Mock mode is opt-in and off by default. It stays in the codebase after M5
 * because it is the only way to develop the frontend with no Socrata token, no
 * Mongo, and no network — and because it is the fallback if the live API is
 * down while someone is working on layout. Read at call time so a test can flip
 * it without re-importing the module.
 */
export function isMockMode() {
  return process.env.USE_MOCK_DATA === "1" || process.env.USE_MOCK_DATA === "true";
}

/**
 * The full POST /api/score payload: counts (cache-first) scored against the
 * citywide baseline.
 *
 * The baseline load is issued alongside the counts rather than after them —
 * it is memoized and usually free, but on the first request of a cold process
 * it is a Mongo round trip that has no reason to sit behind two HTTP calls.
 */
export async function buildScoreReport(lat, lng, options = {}) {
  if (isMockMode()) return mockScoreReport(lat, lng);

  const [{ coord, counts, cache, cachedExplanations }, baseline] =
    await Promise.all([getCounts(lat, lng, options), loadBaseline()]);

  const report = buildReport(counts, baseline, {
    // Coordinates are rounded for the cache key, so the circle we actually
    // queried is not exactly the one asked for. Say so rather than implying
    // more precision than we have.
    coord,
    cache,
  });

  // Explanations are attached here, and NEVER generated here. This endpoint is
  // on the user's critical path; the AI call is not allowed anywhere near it.
  // A cached AI explanation is served if one exists, otherwise the deterministic
  // template goes out immediately and the frontend asks /api/explanation for
  // the real thing.
  for (const [tier, key] of Object.entries(REPORT_KEYS)) {
    report[key] = {
      ...report[key],
      ...resolveCachedExplanation(tier, report[key], cachedExplanations?.[tier]),
    };
  }

  return report;
}

/** Which response key each radius tier lands under. */
const REPORT_KEYS = {
  building: "buildingHealth",
  block: "blockQuality",
};

/**
 * Uses a cached AI explanation when one is stored, otherwise falls back to the
 * template. Only "ai" is accepted from cache: a cached *template* string is
 * worth nothing (we can rebuild it for free) and storing it would make the
 * frontend think the AI had already run and skip its second call.
 */
function resolveCachedExplanation(tier, subScore, cached) {
  if (
    cached?.explanationSource === EXPLANATION_SOURCES.ai &&
    typeof cached.explanation === "string" &&
    cached.explanation !== ""
  ) {
    return {
      explanation: cached.explanation,
      explanationSource: EXPLANATION_SOURCES.ai,
    };
  }
  return explainFromTemplate(tier, subScore);
}

/**
 * The SLOW path behind GET /api/explanation: generate one tier's explanation
 * with the active AI adapter, store it next to the counts, return it.
 *
 * Separated from the score request precisely so the AI latency gets its own
 * request budget instead of stacking behind Socrata + scoring — which is what
 * would blow a serverless execution cap.
 *
 * Returns a cached AI explanation immediately if one already exists, so a
 * double-fire from the frontend costs a Mongo read rather than a generation.
 *
 * @returns {Promise<{explanation, explanationSource, band, cached: boolean}>}
 */
export async function buildExplanation(lat, lng, tier, options = {}) {
  const [{ coord, counts, cachedExplanations }, baseline] = await Promise.all([
    getCounts(lat, lng, { ...options, tiers: [tier] }),
    loadBaseline(),
  ]);

  const subScore = scoreTier(tier, counts[tier], baseline);
  const cached = cachedExplanations?.[tier];

  if (
    cached?.explanationSource === EXPLANATION_SOURCES.ai &&
    typeof cached.explanation === "string" &&
    cached.explanation !== ""
  ) {
    return {
      explanation: cached.explanation,
      explanationSource: EXPLANATION_SOURCES.ai,
      band: subScore.band,
      cached: true,
    };
  }

  const { explanation, explanationSource } = await explainWithAI(tier, subScore);

  // Only AI output is worth storing — see resolveCachedExplanation. Awaited so
  // a serverless process cannot exit before the write lands, and it cannot
  // throw, so it cannot fail the request.
  if (explanationSource === EXPLANATION_SOURCES.ai) {
    await writeExplanation(coord.lat, coord.lng, tier, explanation, explanationSource);
  }

  return { explanation, explanationSource, band: subScore.band, cached: false };
}

/**
 * Individual complaint points for the frontend heatmap.
 *
 * NOT cached: the cache stores bucket counts, not rows, and caching thousands
 * of points per coordinate is what CLAUDE.md's "no bulk ingest" rule exists to
 * prevent. The heatmap is a secondary view; the score is what must be fast.
 */
export async function fetchComplaintPoints(lat, lng, radiusMeters, options = {}) {
  if (isMockMode()) {
    const points = mockComplaints(lat, lng, radiusMeters);
    return { points, truncated: false, limit: points.length };
  }

  const limit = options.limit ?? COMPLAINTS_DEFAULT_LIMIT;
  const points = await fetchComplaints(lat, lng, radiusMeters, { ...options, limit });

  return {
    points,
    // Socrata returns the most recent `limit` rows, so a dense block silently
    // loses its older months. The caller reports this to the client rather than
    // presenting a truncated slice as if it were the whole window.
    truncated: points.length >= limit,
    limit,
  };
}
