import { RADIUS_TIERS, EXPLANATION_SOURCES } from "../config/constants.js";
import { generateExplanation } from "../providers/ai/index.js";
import { templateExplanation } from "./templateExplanation.js";

// Provider-agnostic explanation service. Never branches on AI_PROVIDER — that
// belongs to providers/ai/index.js and nowhere else.
//
// The single rule this file exists to enforce: an AI failure NEVER surfaces to
// the user. Every path returns a usable explanation and a truthful label saying
// where it came from.

/** Human-readable tier names, used in both the prompt and the template. */
export const TIER_LABELS = {
  building: "Building Health",
  block: "Block Quality",
};

/** "this building (25m radius)" — gives the model the area it is describing. */
export function radiusLabelFor(tier) {
  const meters = RADIUS_TIERS[tier]?.radiusMeters;
  const subject = tier === "building" ? "this building" : "this block";
  return meters ? `${subject} (${meters}m radius)` : subject;
}

/**
 * Assembles the adapter input for one tier. Exactly the four fields the shared
 * adapter contract specifies — nothing provider-specific leaks in here.
 */
export function explanationInputFor(tier, subScore) {
  return {
    label: TIER_LABELS[tier] ?? tier,
    band: subScore.band,
    counts: subScore.counts,
    radiusLabel: radiusLabelFor(tier),
  };
}

/** Whether there is anything at all for a model to describe. */
function hasAnyComplaints(counts) {
  return Object.values(counts ?? {}).some((n) => Number.isFinite(n) && n > 0);
}

/**
 * The template explanation, always available, no network. This is what
 * /api/score serves on a cache miss so it can stay fast.
 */
export function explainFromTemplate(tier, subScore) {
  return {
    explanation: templateExplanation({
      ...explanationInputFor(tier, subScore),
      // Not part of the adapter contract, but the template can pick a better
      // bucket with it — raw counts are not comparable across buckets.
      bucketScores: subScore.bucketScores,
    }),
    explanationSource: EXPLANATION_SOURCES.template,
  };
}

/**
 * The AI explanation, with a guaranteed fallback. SLOW — only ever called from
 * GET /api/explanation, never from the score path.
 *
 * Catches everything, including programmer errors like a bad AI_PROVIDER value.
 * A broken explanation must degrade to a worse explanation, never to a broken
 * page: CLAUDE.md is explicit that the demo must never show an error state for
 * this feature.
 *
 * @returns {Promise<{explanation: string, explanationSource: "ai"|"template", error?: string}>}
 */
export async function explainWithAI(tier, subScore) {
  const input = explanationInputFor(tier, subScore);

  // Nothing to explain — and asking anyway produces actively wrong text.
  // Observed with llama3.1:8b on an all-zero building: "there were no
  // complaints filed about unsanitary conditions or plumbing, suggesting these
  // aspects may be areas of concern." Zero complaints described as a concern is
  // worse than no AI at all, and this is exactly the case already flagged
  // confidence: "low". The template says the honest thing, so use it.
  if (!hasAnyComplaints(subScore.counts)) {
    return explainFromTemplate(tier, subScore);
  }

  try {
    const explanation = await generateExplanation(input);
    return { explanation, explanationSource: EXPLANATION_SOURCES.ai };
  } catch (err) {
    // `String(err?.message ?? err)` rather than `err.message`: a throw of a
    // non-Error (a string, an object) would otherwise leave `error: undefined`
    // and the log line blank, hiding the only evidence of a broken adapter.
    const reason = String(err?.message ?? err);
    // Logged, not thrown. Worth logging loudly because a permanently broken
    // adapter is otherwise invisible — every response still looks fine.
    console.warn(`[explain] AI failed for ${tier}, using template:`, reason);
    return { ...explainFromTemplate(tier, subScore), error: reason };
  }
}
