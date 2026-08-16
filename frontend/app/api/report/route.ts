import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/mock-data";

// Mocked backend response. Real version: Express proxy that geocodes the
// address (Google Geocoding), runs two within_circle SoQL queries against
// the 311 Socrata dataset (tight radius for building, wider for block), and
// returns cached/scored results from MongoDB. The ReportResponse shape here
// is the agreed contract — only this handler's body changes when the real
// backend is wired up.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json(
      { error: "Missing required `address` query parameter." },
      { status: 400 }
    );
  }

  // Simulate network + scoring latency so loading states are real.
  await new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 350));

  const report = buildReport(address);
  return NextResponse.json(report);
}
