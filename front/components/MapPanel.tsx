"use client";

import { useId } from "react";
import { MapPinIcon } from "./icons";

const SIZE = 380;
const CENTER = SIZE / 2;
const METERS_PER_PIXEL = 3.2; // ~608m across the panel

export function MapPanel({
  centerLat,
  centerLng,
  buildingRadiusMeters,
  blockRadiusMeters,
}: {
  centerLat: number;
  centerLng: number;
  buildingRadiusMeters: number;
  blockRadiusMeters: number;
}) {
  const patternId = useId();

  const blockRadiusPx = blockRadiusMeters / METERS_PER_PIXEL;
  const buildingRadiusPx = Math.max(6, buildingRadiusMeters / METERS_PER_PIXEL);

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)]"
      style={{ boxShadow: "var(--shadow-md)", border: "1px solid var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--border-hairline)" }}>
        <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
          <MapPinIcon className="h-3.5 w-3.5" />
          {centerLat.toFixed(4)}, {centerLng.toFixed(4)} · Google Maps JS API integration pending
        </div>
      </div>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full" role="img" aria-label="Map showing building and block search radii">
        <defs>
          <pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--gridline)" strokeWidth="1" />
          </pattern>
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

        <circle cx={CENTER} cy={CENTER} r={7} fill="var(--text-primary)" stroke="var(--surface-1)" strokeWidth="2" />
      </svg>

      <div className="flex items-center gap-4 border-t px-4 py-2.5 text-xs text-[color:var(--text-secondary)]" style={{ borderColor: "var(--border-hairline)" }}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--series-building)" }} />
          Building radius ({buildingRadiusMeters}m)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--series-block)" }} />
          Block radius ({blockRadiusMeters}m)
        </span>
      </div>
    </div>
  );
}
