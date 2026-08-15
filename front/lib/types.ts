export type ScoreBand = "good" | "fair" | "poor";
export type Confidence = "normal" | "low";

export type BuildingCounts = {
  heatHotWater: number;
  unsanitaryCondition: number;
  plumbing: number;
};

export type BlockCounts = {
  noise: number;
  parking: number;
  streetCondition: number;
};

export interface ScoreSection<TCounts extends Record<string, number>> {
  score: number;
  band: ScoreBand;
  counts: TCounts;
  radiusMeters: number;
  confidence: Confidence;
  confidenceReason: string | null;
  bucketScores: Partial<Record<keyof TCounts, number>>;
  bucketConfidence: Partial<Record<keyof TCounts, "low">>;
}

export interface ReportMeta {
  windowMonths: number;
  baselineVersion: string;
  baselineSource: "mongo" | "file" | "mock";
  coord: { lat: number; lng: number };
  cache: { building: "hit" | "miss"; block: "hit" | "miss" };
  mock?: boolean;
}

export interface ReportResponse {
  address: string | null;
  buildingHealth: ScoreSection<BuildingCounts>;
  blockQuality: ScoreSection<BlockCounts>;
  meta: ReportMeta;
}

export interface AutocompleteSuggestion {
  id: string;
  description: string;
}
