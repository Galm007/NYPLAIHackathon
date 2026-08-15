import type { ScoreBand } from "./types";

export function bandForScore(score: number): ScoreBand {
  if (score >= 75) return "good";
  if (score >= 50) return "warning";
  if (score >= 25) return "serious";
  return "critical";
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  good: "Good",
  warning: "Fair",
  serious: "Poor",
  critical: "Critical",
};

export const BAND_VERDICT: Record<ScoreBand, string> = {
  good: "Looks solid",
  warning: "Worth a closer look",
  serious: "Proceed with caution",
  critical: "Significant red flags",
};

export function overallBand(a: ScoreBand, b: ScoreBand): ScoreBand {
  const order: ScoreBand[] = ["good", "warning", "serious", "critical"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

export const BAND_VAR: Record<ScoreBand, string> = {
  good: "--status-good",
  warning: "--status-warning",
  serious: "--status-serious",
  critical: "--status-critical",
};

export const CATEGORY_LABEL: Record<string, string> = {
  heatHotWater: "Heat / Hot Water",
  unsanitaryCondition: "Unsanitary Condition",
  plumbing: "Plumbing",
  noise: "Noise",
  illegalParking: "Illegal Parking",
  streetCondition: "Street Condition",
};
