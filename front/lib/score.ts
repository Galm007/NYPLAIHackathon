import type { ScoreBand } from "./types";

export function bandForScore(score: number): ScoreBand {
  if (score >= 70) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export const BAND_VERDICT: Record<ScoreBand, string> = {
  good: "Looks solid",
  fair: "Worth a closer look",
  poor: "Significant red flags",
};

export function overallBand(a: ScoreBand, b: ScoreBand): ScoreBand {
  const order: ScoreBand[] = ["good", "fair", "poor"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

export const BAND_VAR: Record<ScoreBand, string> = {
  good: "--status-good",
  fair: "--status-warning",
  poor: "--status-critical",
};

export const CATEGORY_LABEL: Record<string, string> = {
  heatHotWater: "Heat / Hot Water",
  unsanitaryCondition: "Unsanitary Condition",
  plumbing: "Plumbing",
  noise: "Noise",
  parking: "Illegal Parking",
  streetCondition: "Street Condition",
};

// Suggested UI copy per confidenceReason — see API reference §Confidence.
// "stale_baseline_radius" is a backend misconfiguration and intentionally
// has no user-facing message; surface it to the team instead.
export const CONFIDENCE_MESSAGE: Record<string, string> = {
  no_complaints_found:
    "No records found at this location — this may not be a building address.",
  no_baseline: "Score is not comparable to the rest of the city.",
};
