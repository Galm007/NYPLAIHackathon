import type { AutocompleteSuggestion, ReportResponse } from "./types";

// Thin client for the app's own /api/* routes. Today those routes return
// mock data; once the real backend exists, either point these at it
// directly or keep them as a same-origin proxy — callers don't change.
export async function getLatLng(address: string): Promise<{ lat: number; lng: number } | null> {
  const query = encodeURIComponent(address.trim());
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
    { headers: { "User-Agent": "nypl-hackathon-app" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}
export async function fetchSuggestions(
  query: string,
  signal?: AbortSignal
): Promise<AutocompleteSuggestion[]> {
  if (!query.trim()) return [];
  const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.suggestions ?? [];
}

// export async function fetchReport(lat:number, lng:number): Promise<ReportResponse> {
//   const res = await fetch(`/api/score`, {
//     method:"POST",
//     body:JSON.stringify(
//       {
//         lat:lat,
//         lng:lng
//       }
//     )
//   });
//   if (!res.ok) {
//     const body = await res.json().catch(() => ({}));
//     throw new Error(body.error ?? "Failed to load report");
//   }
//   return res.json();
// }
const API_BASE_URL = "http://localhost:3001";

function mockReport(lat: number, lng: number): ReportResponse {
  return {
    address: null,
    buildingHealth: {
      score: 62,
      band: "fair",
      counts: { heatHotWater: 2, unsanitaryCondition: 3, plumbing: 1 },
      radiusMeters: 25,
      confidence: "normal",
      confidenceReason: null,
      bucketScores: { heatHotWater: 55, unsanitaryCondition: 60, plumbing: 70 },
      bucketConfidence: {},
    },
    blockQuality: {
      score: 78,
      band: "good",
      counts: { noise: 40, parking: 25, streetCondition: 10 },
      radiusMeters: 350,
      confidence: "normal",
      confidenceReason: null,
      bucketScores: { noise: 75, parking: 80, streetCondition: 78 },
      bucketConfidence: {},
    },
    meta: {
      windowMonths: 24,
      baselineVersion: "v1",
      baselineSource: "mock",
      coord: { lat, lng },
      cache: { building: "miss", block: "miss" },
      mock: true,
    },
  };
}

export async function fetchReport(lat: number, lng: number): Promise<ReportResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
  } catch {
    // Backend unreachable (e.g. not running locally) — fall back to mock data.
    return mockReport(lat, lng);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 503) {
      throw new Error("NYC's data service is unavailable right now — try again shortly.");
    }
    throw new Error(body.details ?? body.error ?? "Failed to load report");
  }

  return res.json();
}
