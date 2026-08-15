export type ScoreBand = "good" | "fair" | "poor";

export interface ReportResponse {
  buildingHealth: {
    score: number;
    band: ScoreBand;
    radiusMeters: number;
    counts: {
      heat_hot_water: number;
      unsanitary: number;
      plumbing: number;
    };
  };
  blockQuality: {
    score: number;
    band: ScoreBand;
    counts: {
      noise: number;
      illegal_parking: number;
      street_condition: number;
    };
    radiusMeters: number;
  };
}

export interface AutocompleteSuggestion {
  id: string;
  description: string;
}
