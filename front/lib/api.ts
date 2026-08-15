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

const API_BASE_URL = "http://localhost:3001";

export async function fetchReport(lat: number, lng: number): Promise<ReportResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
  } catch {
    throw new Error("Couldn't reach the backend — is it running?");
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
