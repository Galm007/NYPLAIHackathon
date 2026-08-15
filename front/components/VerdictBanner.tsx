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
      className="rounded-xl border p-5"
      style={{
        borderColor: "var(--border-hairline)",
        background: `color-mix(in srgb, ${color} 6%, var(--surface-1))`,
      }}
    >
      <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">{address}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold" style={{ color }}>
          {BAND_VERDICT[band]}
        </span>
        <StatusBadge band={band} />
      </div>
    </div>
  );
}
