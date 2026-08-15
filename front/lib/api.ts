import type { AutocompleteSuggestion, ReportResponse } from "./types";

// Thin client for the app's own /api/* routes. Today those routes return
// mock data; once the real backend exists, either point these at it
// directly or keep them as a same-origin proxy — callers don't change.

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

export async function fetchReport(address: string): Promise<ReportResponse> {
  const res = await fetch(`/api/report?address=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to load report");
  }
  return res.json();
}
