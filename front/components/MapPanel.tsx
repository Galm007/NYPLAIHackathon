"use client";

import { useId, useState } from "react";
import { MapPinIcon } from "./icons";
import type { Complaint } from "@/lib/types";

const SIZE = 380;
const CENTER = SIZE / 2;
const METERS_PER_PIXEL = 3.2; // ~608m across the panel

function project(lat: number, lng: number, centerLat: number, centerLng: number) {
  const dxMeters = (lng - centerLng) * 111320 * Math.cos((centerLat * Math.PI) / 180);
  const dyMeters = (lat - centerLat) * 111320;
  return {
    x: CENTER + dxMeters / METERS_PER_PIXEL,
    y: CENTER - dyMeters / METERS_PER_PIXEL,
  };
}

export function MapPanel({
  centerLat,
  centerLng,
  buildingRadiusMeters,
  blockRadiusMeters,
  buildingComplaints,
  blockComplaints,
}: {
  centerLat: number;
  centerLng: number;
  buildingRadiusMeters: number;
  blockRadiusMeters: number;
  buildingComplaints: Complaint[];
  blockComplaints: Complaint[];
}) {
  const [mode, setMode] = useState<"pins" | "heatmap">("pins");
  const patternId = useId();
  const blurId = useId();

  const blockRadiusPx = blockRadiusMeters / METERS_PER_PIXEL;
  const buildingRadiusPx = Math.max(6, buildingRadiusMeters / METERS_PER_PIXEL);

  const allPoints = [
    ...buildingComplaints.map((c) => ({ ...c, scope: "building" as const })),
    ...blockComplaints.map((c) => ({ ...c, scope: "block" as const })),
  ].map((c) => ({ ...c, ...project(c.lat, c.lng, centerLat, centerLng) }));

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)]"
      style={{ boxShadow: "var(--shadow-md)", border: "1px solid var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--border-hairline)" }}>
        <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
          <MapPinIcon className="h-3.5 w-3.5" />
          Map preview · sample pins ({"Google Maps JS API integration pending"})
        </div>
        <div className="flex rounded-full border p-0.5 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
          {(["pins", "heatmap"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="rounded-full px-2.5 py-1 capitalize transition-colors"
              style={{
                background: mode === m ? "var(--series-building)" : "transparent",
                color: mode === m ? "#ffffff" : "var(--text-secondary)",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full" role="img" aria-label="Map of nearby 311 complaints">
        <defs>
          <pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--gridline)" strokeWidth="1" />
          </pattern>
          <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        <rect width={SIZE} height={SIZE} fill="var(--surface-1)" />
        <rect width={SIZE} height={SIZE} fill={`url(#${patternId})`} />

        <circle
          cx={CENTER}
          cy={CENTER}
          r={blockRadiusPx}
          fill="none"
          stroke="var(--series-block)"
          strokeOpacity="0.4"
          strokeDasharray="4 4"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={buildingRadiusPx}
          fill="none"
          stroke="var(--series-building)"
          strokeOpacity="0.6"
        />

        {mode === "heatmap" ? (
          <g filter={`url(#${blurId})`}>
            {allPoints.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={16}
                fill={p.scope === "building" ? "var(--series-building)" : "var(--series-block)"}
                fillOpacity="0.35"
              />
            ))}
          </g>
        ) : (
          allPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={5}
              fill={p.scope === "building" ? "var(--series-building)" : "var(--series-block)"}
              stroke="var(--surface-1)"
              strokeWidth="1.5"
            />
          ))
        )}

        <circle cx={CENTER} cy={CENTER} r={7} fill="var(--text-primary)" stroke="var(--surface-1)" strokeWidth="2" />
      </svg>

      <div className="flex items-center gap-4 border-t px-4 py-2.5 text-xs text-[color:var(--text-secondary)]" style={{ borderColor: "var(--border-hairline)" }}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--series-building)" }} />
          Building complaints
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--series-block)" }} />
          Block complaints
        </span>
      </div>
    </div>
  );
}
