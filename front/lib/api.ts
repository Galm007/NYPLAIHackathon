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
const MOCK_REPORT: ReportResponse = {
  buildingHealth: {
    score: 62,
    band: "fair",
    radiusMeters: 25,
    counts: { heat_hot_water: 2, unsanitary: 3, plumbing: 1 },
  },
  blockQuality: {
    score: 78,
    band: "good",
    radiusMeters: 400,
    counts: { noise: 4, illegal_parking: 6, street_condition: 2 },
  },
};

const src = "placeholder";
export async function fetchReport(lat: number, lng: number): Promise<ReportResponse> {
  try {
    const res = await fetch(`${src}/api/score`, {
      method: "POST",
      body: JSON.stringify({ lat, lng }),
    });
    if (!res.ok) return MOCK_REPORT;
    return await res.json();
  } catch {
    return MOCK_REPORT;
  }
}
