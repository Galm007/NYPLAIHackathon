import {
  BAND_THRESHOLDS,
  BUCKET_NAMES,
  BUCKET_WEIGHTS,
  RADIUS_TIERS,
  SCORE_ANCHOR_PERCENTILES,
  SCORE_TAIL_MULTIPLIER,
  SCORE_DEGENERATE_SPAN,
  LOW_CONFIDENCE_BUCKETS,
  CONFIDENCE,
  CONFIDENCE_REASONS,
  WINDOW_MONTHS,
} from "../config/constants.js";

// Pure scoring. No network, no Mongo, no clock — everything here is a function
// of its arguments, so it is tested against committed fixtures.
//
// The whole point of scoring against a baseline rather than showing raw counts:
// "47 noise complaints" means nothing to a renter. "Quieter than 78% of NYC"
// does. The baseline is what makes this a score instead of a count map.

/**
 * Maps a 0-100 sub-score to its band. Higher score = fewer complaints = better.
 * Shared by the mock and the real scorer so thresholds live in exactly one place.
 */
export function bandFor(score) {
  if (score >= BAND_THRESHOLDS.good) return "good";
  if (score >= BAND_THRESHOLDS.fair) return "fair";
  return "poor";
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Anchor points [count, percentile] for one bucket's baseline, always with
 * strictly increasing counts so interpolation cannot divide by zero.
 *
 * TIES RESOLVE TO THE MOST FAVOURABLE PERCENTILE. Complaint counts are small
 * integers over a heavily zero-inflated distribution, so one count routinely
 * spans a wide percentile range — 45% of sampled buildings have zero heat
 * complaints, so "0" covers percentiles 0 through 45. Reporting the bottom of
 * that range is the honest reading of a tie ("tied for fewest in the city"),
 * and it is what guarantees a zero count always scores 100 rather than
 * inheriting a median of 0 and scoring 50.
 *
 * The dangerous side of that guarantee — zero because the lookup missed the
 * building, not because the building is clean — is caught by the low-confidence
 * marker in scoreTier, not by fudging the curve.
 *
 * `zeroShare` is what stops the curve from being nonsense on zero-inflated
 * buckets: it puts the first non-zero count at the TOP of the zero tie, so one
 * plumbing complaint reads as "worse than the 53% of the city with none"
 * instead of being interpolated as if it were halfway to the median.
 */
function anchorsFor(bucketBaseline) {
  const { median: medianPct, p90: p90Pct } = SCORE_ANCHOR_PERCENTILES;
  const median = Math.max(0, Number(bucketBaseline?.median) || 0);
  const p90 = Math.max(median, Number(bucketBaseline?.p90) || 0);
  const rawZeroShare = Number(bucketBaseline?.zeroShare);
  const zeroShare = Number.isFinite(rawZeroShare)
    ? clamp(rawZeroShare, 0, 1)
    : null;

  const anchors = [[0, 0]];

  if (zeroShare !== null && zeroShare > 0) {
    // Everything above zero starts above the whole zero tie.
    anchors.push([1, zeroShare * 100]);
  } else if (p90 === 0) {
    // Degenerate baseline with no zeroShare recorded: the bucket is essentially
    // always zero citywide, so a single complaint is already unusual.
    anchors.push([1, p90Pct]);
  }

  if (median > 0) anchors.push([median, medianPct]);
  if (p90 > 0) anchors.push([p90, p90Pct]);

  // Beyond p90 the baseline says nothing about shape, so extrapolate over a
  // multiple of the median→p90 spread. When median is 0 that spread is p90.
  const spread = p90 - median > 0 ? p90 - median : p90;
  anchors.push([
    p90 > 0 ? p90 + SCORE_TAIL_MULTIPLIER * spread : SCORE_DEGENERATE_SPAN,
    100,
  ]);

  return normalizeAnchors(anchors);
}

/**
 * Sorts anchors by count, collapses tied counts to their lowest percentile, and
 * drops any anchor that would make the curve non-monotonic. Without the last
 * step a bucket whose median sits below its zero-tie ceiling would produce a
 * curve where MORE complaints scored BETTER.
 */
function normalizeAnchors(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [count, percentile] of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push([count, percentile]);
      continue;
    }
    if (count <= last[0] || percentile <= last[1]) continue;
    out.push([count, percentile]);
  }
  // The final anchor must reach 100 and must sit strictly right of the previous
  // one, or a count past the end of the curve has nothing to interpolate to.
  const last = out[out.length - 1];
  if (last[1] < 100) out.push([last[0] + Math.max(1, last[0]), 100]);
  return out;
}

/**
 * Where `count` sits in the citywide distribution for its bucket: 0 = fewest
 * complaints in the city, 100 = worst. Piecewise-linear through the anchors.
 */
export function percentileFor(count, bucketBaseline) {
  const n = Number.isFinite(count) ? Math.max(0, count) : 0;
  const anchors = anchorsFor(bucketBaseline);

  if (n <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (n <= x1) return y0 + ((y1 - y0) * (n - x0)) / (x1 - x0);
  }
  return 100;
}

/** One bucket's 0-100 score. Inverted percentile: MORE complaints = LOWER score. */
export function bucketScore(count, bucketBaseline) {
  return clamp(100 - percentileFor(count, bucketBaseline), 0, 100);
}

/**
 * Weighted mean of the bucket scores. Weights are all 1 today, so this is a
 * plain mean — it goes through BUCKET_WEIGHTS so that changing a bucket's
 * influence is an explicit edit there rather than padding its complaint_type
 * list, which is the failure mode CLAUDE.md decision 6 warns about.
 */
function aggregate(bucketScores) {
  let weighted = 0;
  let totalWeight = 0;
  for (const [bucket, score] of Object.entries(bucketScores)) {
    const weight = BUCKET_WEIGHTS[bucket] ?? 1;
    weighted += score * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : weighted / totalWeight;
}

/**
 * Scores one radius tier into its slice of the frozen response shape.
 *
 * @param {"building"|"block"} tierName
 * @param {Record<string, number>} counts   summed per bucket (never per string)
 * @param {object|null} baseline            full baseline doc, or null if absent
 */
export function scoreTier(tierName, counts, baseline) {
  const buckets = BUCKET_NAMES[tierName];
  const { radiusMeters } = RADIUS_TIERS[tierName];
  const perBucket = baseline?.perBucket ?? null;

  const safeCounts = {};
  const bucketScores = {};
  for (const bucket of buckets) {
    // A missing bucket must not become NaN and silently poison the mean. The
    // provider zero-fills, but the mock and any hand-built payload may not.
    safeCounts[bucket] = Number.isFinite(counts?.[bucket]) ? counts[bucket] : 0;
    bucketScores[bucket] = Math.round(
      bucketScore(safeCounts[bucket], perBucket?.[bucket])
    );
  }

  const score = Math.round(aggregate(bucketScores));

  // Confidence, in priority order — the reason shown is the one that most
  // undermines the number.
  let confidence = CONFIDENCE.normal;
  let confidenceReason = null;

  if (!perBucket) {
    confidence = CONFIDENCE.low;
    confidenceReason = CONFIDENCE_REASONS.noBaseline;
  } else if (baselineRadiusMismatch(baseline, tierName)) {
    confidence = CONFIDENCE.low;
    confidenceReason = CONFIDENCE_REASONS.staleBaseline;
  } else if (buckets.every((bucket) => safeCounts[bucket] === 0)) {
    // Every bucket zero is far more likely to be a coordinate that missed its
    // building than a genuinely spotless one. Report the score, flag the doubt.
    confidence = CONFIDENCE.low;
    confidenceReason = CONFIDENCE_REASONS.noComplaintsFound;
  }

  // Only non-normal buckets are listed, so an empty object means "all solid".
  const bucketConfidence = {};
  for (const bucket of buckets) {
    if (bucket in LOW_CONFIDENCE_BUCKETS) {
      bucketConfidence[bucket] = CONFIDENCE.low;
    }
  }

  return {
    score,
    band: bandFor(score),
    counts: safeCounts,
    radiusMeters,
    confidence,
    confidenceReason,
    bucketScores,
    bucketConfidence,
  };
}

/**
 * A baseline is only meaningful for the radii it was sampled at — the same
 * address at 25m and 50m produces different counts. If someone retunes
 * RADIUS_TIERS without rerunning scripts/buildBaseline.js, every score silently
 * shifts. Detect that rather than serving numbers that look fine.
 */
function baselineRadiusMismatch(baseline, tierName) {
  const sampled = baseline?.radiusMeters?.[tierName];
  if (!Number.isFinite(sampled)) return false; // pre-radius baselines: trust it
  return sampled !== RADIUS_TIERS[tierName].radiusMeters;
}

/**
 * The full POST /api/score payload. `address` is always null — we do not geocode.
 *
 * @param {{building: object, block: object}} counts  bucket counts per tier
 * @param {object|null} baseline                      baseline doc, or null
 * @param {object} [meta]                             non-scoring extras (cache, etc.)
 */
export function buildReport(counts, baseline, meta = {}) {
  return {
    address: null,
    buildingHealth: scoreTier("building", counts?.building, baseline),
    blockQuality: scoreTier("block", counts?.block, baseline),
    meta: {
      windowMonths: WINDOW_MONTHS,
      baselineVersion: baseline?._id ?? null,
      baselineSource: baseline ? (baseline.source ?? null) : null,
      ...meta,
    },
  };
}
