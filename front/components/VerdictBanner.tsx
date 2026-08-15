import { BAND_VAR, BAND_VERDICT, overallBand } from "@/lib/score";
import { StatusBadge } from "./StatusBadge";
import type { ScoreBand } from "@/lib/types";

export function VerdictBanner({
  buildingBand,
  blockBand,
  address,
}: {
  buildingBand: ScoreBand;
  blockBand: ScoreBand;
  address: string;
}) {
  const band = overallBand(buildingBand, blockBand);
  const color = `var(${BAND_VAR[band]})`;

  return (
    <div
      className="rounded-[var(--radius-lg)] p-6"
      style={{
        boxShadow: "var(--shadow-md)",
        border: "1px solid var(--border-hairline)",
        borderLeft: `3px solid ${color}`,
        background: `color-mix(in srgb, ${color} 5%, var(--surface-1))`,
      }}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">{borough}</p>
      <h1 className="mt-1 text-xl font-semibold text-[color:var(--text-primary)]">{address}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-bold tracking-tight" style={{ color }}>
          {BAND_VERDICT[band]}
        </span>
        <StatusBadge band={band} />
      </div>
    </div>
  );
}
