import { ComplaintBreakdownBars } from "./ComplaintBreakdownBars";
import { RecentComplaintsList } from "./RecentComplaintsList";
import { ScoreMeter } from "./ScoreMeter";
import { StatusBadge } from "./StatusBadge";
import { TrendSparkline } from "./TrendSparkline";
import type { ScorePanel } from "@/lib/types";

export function ScorePanelCard({
  icon,
  panel,
  colorVar,
  description,
}: {
  icon: React.ReactNode;
  panel: ScorePanel;
  colorVar: string;
  description: string;
}) {
  return (
    <div
      className="flex flex-col gap-5 rounded-xl border p-5"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
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
            <h2 className="font-semibold text-[color:var(--text-primary)]">{panel.label}</h2>
            <p className="text-xs text-[color:var(--text-muted)]">{description}</p>
          </div>
        </div>
        <StatusBadge band={panel.band} />
      </div>

      <div className="flex items-center gap-5">
        <ScoreMeter score={panel.score} band={panel.band} size={104} />
        <div className="flex-1 text-sm text-[color:var(--text-secondary)]">
          <p>
            <span className="font-medium text-[color:var(--text-primary)]">
              {panel.totalComplaints}
            </span>{" "}
            complaints in the last 12 months within{" "}
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
          counts={panel.complaintCounts}
          colorVar={colorVar}
          panelLabel={panel.label}
          score={panel.score}
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          12-month trend
        </p>
        <TrendSparkline data={panel.trend} colorVar={colorVar} />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          Recent complaints
        </p>
        <RecentComplaintsList complaints={panel.recentComplaints} />
      </div>
    </div>
  );
}
