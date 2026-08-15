export type ComplaintCategory =
  | "heatHotWater"
  | "unsanitaryCondition"
  | "plumbing"
  | "noise"
  | "illegalParking"
  | "streetCondition";

export type ComplaintStatus = "open" | "in-progress" | "closed";

export interface Complaint {
  id: string;
  category: ComplaintCategory;
  label: string;
  date: string; // ISO date
  status: ComplaintStatus;
  description: string;
  lat: number;
  lng: number;
}

export interface TrendPoint {
  month: string; // "2025-08"
  count: number;
}

export type ScoreBand = "good" | "warning" | "serious" | "critical";

export interface ScorePanel {
  score: number; // 0-100, higher is better
  band: ScoreBand;
  label: string;
  radiusMeters: number;
  totalComplaints: number;
  complaintCounts: Partial<Record<ComplaintCategory, number>>;
  trend: TrendPoint[];
  recentComplaints: Complaint[];
}

export interface ReportResponse {
  query: string;
  address: string;
  borough: string;
  lat: number;
  lng: number;
  buildingHealth: ScorePanel;
  blockQuality: ScorePanel;
  meta: {
    dataSource: string;
    lastUpdated: string;
    cacheAgeMinutes: number;
    isMockData: boolean;
  };
}

export interface AutocompleteSuggestion {
  id: string;
  description: string;
}
