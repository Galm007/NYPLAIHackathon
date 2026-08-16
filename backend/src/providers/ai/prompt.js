// The prompt is SHARED by every adapter, deliberately. Llama 3 and Gemini
// Flash-Lite are different models; the only thing keeping their output feeling
// like one product is that they are asked the same question in the same words.
// Do not fork this per adapter — tighten it here instead.

/** Human-readable bucket names. The model should never see our camelCase keys. */
const BUCKET_LABELS = {
  heatHotWater: "heat and hot water",
  unsanitaryCondition: "unsanitary conditions",
  plumbing: "plumbing",
  noise: "noise",
  parking: "illegal parking and blocked driveways",
  streetCondition: "street and sidewalk condition",
};

/** What each band is supposed to mean to a renter, in plain words. */
const BAND_MEANING = {
  good: "better than most of New York City",
  fair: "about typical for New York City",
  poor: "worse than most of New York City",
};

export function bucketLabel(bucket) {
  return BUCKET_LABELS[bucket] ?? bucket;
}

/** "12 heat and hot water, 3 plumbing, 0 unsanitary conditions" */
function formatCounts(counts) {
  return Object.entries(counts ?? {})
    .map(([bucket, count]) => `${count} ${bucketLabel(bucket)}`)
    .join(", ");
}

/**
 * Builds the full prompt for one sub-score.
 *
 * @param {object} input
 * @param {string} input.label        e.g. "Building Health"
 * @param {string} input.band         "good" | "fair" | "poor"
 * @param {object} input.counts       bucket -> count
 * @param {string} input.radiusLabel  e.g. "this building (25m)"
 * @returns {string}
 */
export function buildPrompt({ label, band, counts, radiusLabel }) {
  return [
    "You explain a neighborhood quality score to someone deciding whether to rent an apartment in New York City.",
    "",
    `Score name: ${label}`,
    `Rating: ${band} — ${BAND_MEANING[band] ?? "typical for New York City"}`,
    `Area covered: ${radiusLabel}`,
    `311 complaints filed in the last 24 months: ${formatCounts(counts)}`,
    "",
    "Write 1-2 short sentences explaining what this rating means for someone living here.",
    "",
    "Rules:",
    // Cross-provider consistency rules. These exist because llama3.1:8b and
    // gemini-3.5-flash-lite drifted apart on exactly these three points when
    // given the earlier, looser prompt — Gemini restated the rating and quoted
    // the counts, Llama ran to three sentences. Tightening the SHARED prompt is
    // what keeps one product; per-adapter patches would guarantee two.
    "- Maximum 2 sentences. Stop after the second.",
    `- Never state the rating word ("${band}") or repeat the comparison to the rest of New York City. The reader can already see the rating.`,
    "- Do not put quotation marks around the complaint types or the numbers.",
    // This is the main defense against hallucinated specifics. An invented
    // address or incident in a renting decision is the worst thing this feature
    // could produce, so it is stated first and stated twice.
    "- Use ONLY the complaint numbers given above. Do not invent addresses, dates, street names, landlords, or specific incidents.",
    "- Do not mention any fact that is not in the numbers above.",
    // Observed: llama3.1 called 2876-vs-1253 "nearly three times as many" (it is
    // 2.3x). Small models do arithmetic badly, and a wrong ratio is a factual
    // error in a renting decision. Quote the counts, do not derive from them.
    "- Quote the counts as given. Do not calculate ratios, percentages, averages, or 'X times more' comparisons.",
    "- Name the complaint types that stand out, or say complaints are low if they are.",
    "- Do not use the words percentile, score, baseline, median, data, or dataset.",
    "- Plain, calm, factual. No marketing language, no emoji, no bullet points, no headings.",
    // Small models reliably open with "The <score name> rating indicates that…"
    // unless told concretely what NOT to write. Naming the exact bad opening
    // works where "do not restate the rating name" alone did not.
    `- Do not begin with "The ${label}" or any restatement of the score name. Start with what a resident would notice.`,
    "- Do not use a greeting.",
    "",
    "Explanation:",
  ].join("\n");
}
