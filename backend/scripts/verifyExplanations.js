/**
 * Runs every available AI adapter against the SAME fixed inputs and prints the
 * outputs side by side, next to the deterministic template.
 *
 *   npm run verify:explanations
 *
 * This is the tone-consistency check CLAUDE.md requires before demo day.
 * Llama 3 and Gemini Flash-Lite are different models and may not produce
 * similarly-toned output from an identical prompt. If they diverge noticeably,
 * tighten prompt.js — do NOT ship two different-feeling products depending on
 * which environment someone is looking at.
 *
 * Also worth reading the output for the things unit tests cannot check:
 *   - invented specifics (an address, a date, a landlord) — the worst failure
 *   - technical vocabulary leaking through ("percentile", "baseline")
 *   - derived arithmetic ("three times as many"), which models get wrong
 *   - length: 1-2 sentences, not a paragraph
 *
 * Adapters with no credentials are skipped, not failed — this must be runnable
 * locally with only Ollama, and on a machine with only a Gemini key.
 */

import { AI_PROVIDERS, AI_MODELS, RADIUS_TIERS } from "../src/config/constants.js";
import { buildPrompt } from "../src/providers/ai/prompt.js";
import { templateExplanation } from "../src/services/templateExplanation.js";

// Real count shapes, taken from live lookups. Fixed on purpose: the point is to
// compare providers against each other, which needs the inputs held constant.
const FIXTURES = [
  {
    name: "Bushwick — clean building, loud block",
    tier: "block",
    label: "Block Quality",
    band: "poor",
    counts: { noise: 2876, parking: 1253, streetCondition: 144 },
  },
  {
    name: "Bushwick — the building itself",
    tier: "building",
    label: "Building Health",
    band: "good",
    counts: { heatHotWater: 5, unsanitaryCondition: 0, plumbing: 1 },
  },
  {
    name: "Midtown — middling on both",
    tier: "block",
    label: "Block Quality",
    band: "fair",
    counts: { noise: 834, parking: 1116, streetCondition: 302 },
  },
  {
    name: "Neglected building",
    tier: "building",
    label: "Building Health",
    band: "poor",
    counts: { heatHotWater: 412, unsanitaryCondition: 88, plumbing: 51 },
  },
];

/** Words that should never reach a renter. */
const BANNED_TERMS = ["percentile", "baseline", "median", "dataset", "score of"];
/** Phrasings that indicate the model did arithmetic it was told not to do. */
const RATIO_PATTERN = /\b(times (as )?(many|more|higher)|\d+\s?%|percent|ratio|average of)\b/i;

function radiusLabelFor(tier) {
  const meters = RADIUS_TIERS[tier]?.radiusMeters;
  const subject = tier === "building" ? "this building" : "this block";
  return `${subject} (${meters}m radius)`;
}

async function availableAdapters() {
  const available = [];

  // Ollama: available if something answers on the port.
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const models = (await res.json()).models?.map((m) => m.name) ?? [];
      if (!models.includes(AI_MODELS.ollama)) {
        console.warn(
          `WARNING: ollama is running but "${AI_MODELS.ollama}" is not pulled.\n` +
            `         Available: ${models.join(", ") || "(none)"}\n` +
            `         Run: ollama pull ${AI_MODELS.ollama}\n`
        );
      } else {
        available.push(AI_PROVIDERS.ollama);
      }
    }
  } catch {
    console.warn("SKIP ollama — nothing answering on localhost:11434 (run `ollama serve`)\n");
  }

  if (process.env.GEMINI_API_KEY) {
    available.push(AI_PROVIDERS.gemini);
  } else {
    console.warn("SKIP gemini — GEMINI_API_KEY is not set\n");
  }

  return available;
}

const providers = await availableAdapters();

if (providers.length === 0) {
  console.error(
    "No AI adapter is available, so there is nothing to compare.\n" +
      "The API still works — every explanation falls back to the template."
  );
  process.exit(2);
}

console.log(`Comparing: ${providers.join(", ")}`);
for (const provider of providers) {
  console.log(`  ${provider.padEnd(8)} model ${AI_MODELS[provider]}`);
}
if (providers.length === 1) {
  console.log(
    "\nNOTE: only one adapter available, so this run cannot compare TONE across\n" +
      "providers. Re-run with both before demo day."
  );
}

let warnings = 0;

for (const fixture of FIXTURES) {
  const input = {
    label: fixture.label,
    band: fixture.band,
    counts: fixture.counts,
    radiusLabel: radiusLabelFor(fixture.tier),
  };

  console.log(`\n${"=".repeat(78)}`);
  console.log(`${fixture.name}  [${fixture.label} / ${fixture.band}]`);
  console.log(`counts: ${JSON.stringify(fixture.counts)}`);
  console.log("=".repeat(78));

  console.log("\n  template:");
  console.log(`    ${templateExplanation({ ...input, counts: fixture.counts })}`);

  for (const provider of providers) {
    process.env.AI_PROVIDER = provider;
    // Imported fresh per provider so the factory re-reads AI_PROVIDER.
    const { generateExplanation } = await import("../src/providers/ai/index.js");

    const started = performance.now();
    let text;
    try {
      text = await generateExplanation(input);
    } catch (err) {
      console.log(`\n  ${provider}:`);
      console.log(`    FAILED: ${err.message.slice(0, 160)}`);
      console.log("    (the API would serve the template above — no user-visible error)");
      warnings++;
      continue;
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);

    console.log(`\n  ${provider} (${seconds}s):`);
    console.log(`    ${text}`);

    // Automated checks for the failures that are easy to miss by eye.
    const lower = text.toLowerCase();
    for (const term of BANNED_TERMS) {
      if (lower.includes(term)) {
        console.log(`    WARN  leaked technical term: "${term}"`);
        warnings++;
      }
    }
    if (RATIO_PATTERN.test(text)) {
      console.log("    WARN  looks like derived arithmetic — models get these wrong");
      warnings++;
    }
    for (const count of Object.values(fixture.counts)) {
      if (count === 0) continue;
      // Not exhaustive, just a smell test: numbers in the text that are not
      // ours are either arithmetic or invention.
      const numbers = text.match(/\b\d{2,}\b/g) ?? [];
      const ours = Object.values(fixture.counts).map(String);
      const foreign = numbers.filter((n) => !ours.includes(n) && n !== "311" && n !== "24");
      if (foreign.length > 0) {
        console.log(`    WARN  numbers not in the input: ${[...new Set(foreign)].join(", ")}`);
        warnings++;
      }
      break;
    }
    const sentences = text.split(/[.!?]+\s/).filter(Boolean).length;
    if (sentences > 3) {
      console.log(`    WARN  ${sentences} sentences — asked for 1-2`);
      warnings++;
    }
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log("Prompt sent (identical for every provider — that is the point):");
console.log("=".repeat(78));
console.log(
  buildPrompt({
    label: FIXTURES[0].label,
    band: FIXTURES[0].band,
    counts: FIXTURES[0].counts,
    radiusLabel: radiusLabelFor(FIXTURES[0].tier),
  })
);

console.log(
  warnings === 0
    ? "\nNo automated warnings. Still read the outputs above for tone and invented specifics."
    : `\n${warnings} warning(s) above. Tighten prompt.js rather than patching one adapter.`
);
