import { ComplaintBreakdownBars } from "./ComplaintBreakdownBars";
import { ScoreMeter } from "./ScoreMeter";
import { StatusBadge } from "./StatusBadge";
import { CONFIDENCE_MESSAGE } from "@/lib/score";
import type { Confidence, ScoreBand } from "@/lib/types";

export function ScorePanelCard({
  icon,
  title,
  panel,
  colorVar,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  panel: {
    score: number;
    band: ScoreBand;
    radiusMeters: number;
    counts: Record<string, number>;
    confidence: Confidence;
    confidenceReason: string | null;
  };
  colorVar: string;
  description: string;
}) {
  const totalComplaints = Object.values(panel.counts).reduce((sum, n) => sum + n, 0);
  const confidenceMessage =
    panel.confidence === "low" && panel.confidenceReason
      ? CONFIDENCE_MESSAGE[panel.confidenceReason]
      : null;

  return (
    <div
      className="flex flex-col gap-5 rounded-[var(--radius-lg)] bg-[color:var(--surface-1)] p-6"
      style={{ boxShadow: "var(--shadow-md)", border: "1px solid var(--border-hairline)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              color: `var(${colorVar})`,
              background: `color-mix(in srgb, var(${colorVar}) 14%, transparent)`,
            }}
          >
            {icon}
          </span>
          <div>
            <h2 className="font-semibold text-[color:var(--text-primary)]">{title}</h2>
            <p className="text-xs text-[color:var(--text-muted)]">{description}</p>
          </div>
        </div>
        <StatusBadge band={panel.band} />
      </div>

      {confidenceMessage && (
        <p
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            color: "var(--status-warning)",
            background: "color-mix(in srgb, var(--status-warning) 12%, transparent)",
          }}
        >
          {confidenceMessage}
        </p>
      )}

      <div className="flex items-center gap-5">
        <ScoreMeter score={panel.score} band={panel.band} size={104} />
        <div className="flex-1 text-sm text-[color:var(--text-secondary)]">
          <p>
            <span className="font-medium text-[color:var(--text-primary)]">
              {totalComplaints}
            </span>{" "}
            complaints within{" "}
            <span className="font-medium text-[color:var(--text-primary)]">
              {panel.radiusMeters}m
            </span>
            .
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          By category
        </p>
        <ComplaintBreakdownBars
          counts={panel.counts}
          colorVar={colorVar}
          panelLabel={title}
          score={panel.score}
        />
      </div>
    </div>
  );
}
