import { buildReport } from "./mock-data";
import type { AutocompleteSuggestion, ReportResponse } from "./types";

// Geocoding (via /api/geocode, Google under the hood) can return zero
// results whenever a unit designator — apt/unit/suite/floor/room/# — is
// present, even though the building itself geocodes fine. Since scoring
// only needs the building's coordinates, strip these before falling back
// to a second lookup.
function stripUnit(address: string): string {
  return address
    .replace(/[,\s]*#\s*[\w-]+/g, "")
    .replace(
      /[,\s]*\b(apt|apartment|unit|suite|ste|fl|floor|rm|room|ph|penthouse|no)\.?\s*[\w-]+/gi,
      ""
    )
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(`/api/geocode?address=${encodeURIComponent(query)}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (typeof data.lat !== "number" || typeof data.lng !== "number") return null;
  return { lat: data.lat, lng: data.lng };
}

async function geocodeByPlaceId(placeId: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(`/api/geocode?placeId=${encodeURIComponent(placeId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (typeof data.lat !== "number" || typeof data.lng !== "number") return null;
  return { lat: data.lat, lng: data.lng };
}

export async function getLatLng(address: string, placeId?: string): Promise<{ lat: number; lng: number } | null> {
  if (placeId) {
    const result = await geocodeByPlaceId(placeId);
    if (result) return result;
  }

  const trimmed = address.trim();
  const result = await geocode(trimmed);
  if (result) return result;

  const stripped = stripUnit(trimmed);
  if (stripped && stripped !== trimmed) return geocode(stripped);
  return null;
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

export async function fetchReport(lat: number, lng: number, address?: string): Promise<ReportResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
  } catch {
    if (address) return buildReport(address);
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
