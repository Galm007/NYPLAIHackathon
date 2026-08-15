import { NextRequest, NextResponse } from "next/server";
import { findSuggestions } from "@/lib/mock-data";

// Stands in for a Google Places Autocomplete proxy. Same response shape
// (`{ suggestions: [{ id, description }] }`) so swapping in the real call
// later is a one-file change.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const suggestions = findSuggestions(q).map((s) => ({
    id: s.id,
    description: s.description,
  }));
  return NextResponse.json({ suggestions });
}
