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
  heat_hot_water: "Heat / Hot Water",
  unsanitary: "Unsanitary Condition",
  plumbing: "Plumbing",
  noise: "Noise",
  illegal_parking: "Illegal Parking",
  street_condition: "Street Condition",
};
