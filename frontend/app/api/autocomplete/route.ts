import { NextRequest, NextResponse } from "next/server";
import { findSuggestions } from "@/lib/mock-data";

// Google Places Autocomplete (New) API for real NYC address suggestions.
// Falls back to local mock suggestions if no API key is configured, so the
// search bar still works without Google Maps set up.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";

  if (!q.trim()) {
    return NextResponse.json({ suggestions: [] });
  }

  const mockFallback = () =>
    NextResponse.json({
      suggestions: findSuggestions(q).map((s) => ({ id: s.id, description: s.description })),
    });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return mockFallback();
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["us"],
        locationBias: {
          circle: {
            center: { latitude: 40.7128, longitude: -74.006 }, // NYC center
            radius: 25000, // ~15 miles, covers the five boroughs
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Places API error:", response.status, errorText);
      return mockFallback();
    }

    const data = await response.json();
    const suggestions = (data.suggestions ?? [])
      .slice(0, 6)
      .map((s: any) => ({
        id: s.placePrediction?.placeId ?? "",
        description: s.placePrediction?.text?.text ?? "",
      }))
      .filter((s: { id: string; description: string }) => s.description);

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Autocomplete error:", error);
    return mockFallback();
  }
}
