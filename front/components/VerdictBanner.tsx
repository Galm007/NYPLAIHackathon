import { BAND_VAR, BAND_VERDICT, overallBand } from "@/lib/score";
import { StatusBadge } from "./StatusBadge";
import type { ScoreBand } from "@/lib/types";

export function VerdictBanner({
  buildingBand,
  blockBand,
  address,
  borough,
}: {
  buildingBand: ScoreBand;
  blockBand: ScoreBand;
  address: string;
  borough: string;
}) {
  const band = overallBand(buildingBand, blockBand);
  const color = `var(${BAND_VAR[band]})`;

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        borderColor: "var(--border-hairline)",
        background: `color-mix(in srgb, ${color} 6%, var(--surface-1))`,
      }}
    >
      <p className="text-xs text-[color:var(--text-muted)]">{borough}</p>
      <h1 className="mt-0.5 text-lg font-semibold text-[color:var(--text-primary)]">{address}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold" style={{ color }}>
          {BAND_VERDICT[band]}
        </span>
        <StatusBadge band={band} />
      </div>
    </div>
  );
}
