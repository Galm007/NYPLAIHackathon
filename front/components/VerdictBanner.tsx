import { BAND_VAR, BAND_VERDICT, explainVerdict, overallBand } from "@/lib/score";
import { StatusBadge } from "./StatusBadge";
import type { BlockCounts, BuildingCounts, ScoreSection } from "@/lib/types";

export function VerdictBanner({
  building,
  block,
  address,
  windowMonths,
}: {
  building: ScoreSection<BuildingCounts>;
  block: ScoreSection<BlockCounts>;
  address: string;
  windowMonths: number;
}) {
  const band = overallBand(building.band, block.band);
  const color = `var(${BAND_VAR[band]})`;
  const explanation = explainVerdict(building, block, band, windowMonths);

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
      <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">{address}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-bold tracking-tight" style={{ color }}>
          {BAND_VERDICT[band]}
        </span>
        <StatusBadge band={band} />
      </div>
      <p className="mt-1.5 text-sm text-[color:var(--text-muted)]">{explanation}</p>
    </div>
  );
}
