export type ScoreBand = "good" | "fair" | "poor";

export type ComplaintStatus = "open" | "in-progress" | "closed";

export interface Complaint {
  id: string;
  label: string;
  date: string; // YYYY-MM-DD
  status: ComplaintStatus;
}

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
    recentComplaints?: Complaint[];
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
    recentComplaints?: Complaint[];
  };
}

export interface AutocompleteSuggestion {
  id: string;
  description: string;
}
