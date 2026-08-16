import { bucketLabel } from "../providers/ai/prompt.js";

// The deterministic fallback. This is what a renter reads when the AI call
// times out, hits a rate limit, or was never made because /api/score must not
// block on it.
//
// Two hard requirements, both from CLAUDE.md:
// 1. It CANNOT fail. No network, no I/O, no throwing — every branch returns a
//    string, including for inputs that make no sense.
// 2. It must read like a finished product, not a placeholder. On a cache miss
//    this is the first thing the user sees, and on the demo path it may be the
//    only thing they see. "Explanation unavailable" is not acceptable output.

/** Keyed by band; the dominant bucket is slotted in by the callers below. */
const BAND_OPENERS = {
  good: "Fewer 311 complaints here than in most of the city",
  fair: "About as many 311 complaints here as a typical part of the city",
  poor: "More 311 complaints here than in most of the city",
};

const TIER_SUBJECTS = {
  "Building Health": {
    quiet: "Residents have filed few maintenance complaints at this address recently.",
    context: "for this building",
  },
  "Block Quality": {
    quiet: "Neighbors have filed few complaints about this block recently.",
    context: "for this block",
  },
};

/**
 * Scores this close together are not meaningfully different, and the sentence
 * below says a bucket "stands out" — so a near-tie is broken by raw count.
 */
const SCORE_TIE_MARGIN = 10;

/**
 * The bucket most responsible for the rating.
 *
 * Prefers `bucketScores` when the caller has them, because raw counts are not
 * comparable across buckets — a block with 2,876 noise and 144 street-condition
 * complaints may still be dragged down by street condition, since the citywide
 * norms for the two are an order of magnitude apart.
 *
 * But a pure worst-score pick reads badly on a near-tie: scores of 86 (plumbing,
 * 1 complaint) and 88 (heat, 5 complaints) produced "Plumbing stands out with 1
 * complaint", which is not what a reader would call standing out. Within the tie
 * margin, the larger count wins. Falls back to the largest count entirely when
 * no scores are supplied.
 */
export function dominantBucket({ counts = {}, bucketScores = null }) {
  const buckets = Object.keys(counts);
  if (buckets.length === 0) return null;

  const byCount = (candidates) =>
    candidates.reduce((worst, bucket) =>
      (counts[bucket] ?? 0) > (counts[worst] ?? 0) ? bucket : worst
    );

  if (bucketScores) {
    const scored = buckets.filter((bucket) => Number.isFinite(bucketScores[bucket]));
    if (scored.length > 0) {
      const worstScore = Math.min(...scored.map((bucket) => bucketScores[bucket]));
      const contenders = scored.filter(
        (bucket) => bucketScores[bucket] - worstScore <= SCORE_TIE_MARGIN
      );
      return byCount(contenders);
    }
  }

  return byCount(buckets);
}

/**
 * Builds the fallback explanation.
 *
 * @param {object} input
 * @param {string} input.label            "Building Health" | "Block Quality"
 * @param {string} input.band             "good" | "fair" | "poor"
 * @param {object} input.counts           bucket -> count
 * @param {object} [input.bucketScores]   bucket -> 0-100, improves bucket choice
 * @returns {string} always a non-empty sentence
 */
export function templateExplanation({ label, band, counts = {}, bucketScores }) {
  const subject = TIER_SUBJECTS[label] ?? {
    quiet: "Few complaints have been filed here recently.",
    context: "for this location",
  };
  const opener = BAND_OPENERS[band] ?? BAND_OPENERS.fair;

  const total = Object.values(counts).reduce(
    (sum, n) => sum + (Number.isFinite(n) ? n : 0),
    0
  );

  // No complaints at all. Deliberately does NOT congratulate: this is also what
  // a coordinate that missed its building looks like, and the response carries
  // confidence: "low" alongside it.
  if (total === 0) {
    return `No 311 complaints were filed in this category in the last 24 months. ${subject.quiet}`;
  }

  const bucket = dominantBucket({ counts, bucketScores });
  const count = counts[bucket] ?? 0;
  const noun = bucketLabel(bucket);

  if (count === 0) {
    return `${opener} ${subject.context}, across ${total} complaints in the last 24 months.`;
  }

  const plural = count === 1 ? "complaint" : "complaints";
  return (
    `${opener} ${subject.context}. ` +
    `${noun.charAt(0).toUpperCase()}${noun.slice(1)} stands out with ` +
    `${count} ${plural} in the last 24 months, out of ${total} total.`
  );
}
