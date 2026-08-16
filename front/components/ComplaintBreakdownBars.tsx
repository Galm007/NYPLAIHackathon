import { useMemo, useState } from "react";
import { CATEGORY_LABEL } from "@/lib/score";

export function ComplaintBreakdownBars({
  counts,
  panelLabel,
  score,
}: {
  counts: Record<string, number>;
  colorVar: string;
  panelLabel?: string;
  score?: number;
}) {
  const entries = Object.entries(counts);
  const [isHovered, setIsHovered] = useState(false);

  const explanation = useMemo(() => {
    if (!panelLabel || panelLabel !== "Block Quality" || typeof score !== "number") {
      return null;
    }

    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const total = entries.reduce((sum, [, count]) => sum + count, 0);

    if (!top) {
      return "This block has very little neighborhood complaint activity, which keeps its quality score strong.";
    }

    const [category, count] = top;
    const categoryName = CATEGORY_LABEL[category] ?? category;

    if (score >= 75) {
      return count <= 1
        ? `This block scores well because complaints are very low overall, with only a minor ${categoryName.toLowerCase()} issue driving the score.`
        : `This block scores well because neighborhood issues are limited. ${categoryName} is the largest driver, but it is still low enough that the overall block quality remains strong.`;
    }

    if (score >= 50) {
      return `This block is in the middle range because ${categoryName.toLowerCase()} is the biggest complaint type, even though total complaints are not extreme.`;
    }

    if (total === 0) {
      return "This block is performing poorly because the complaint profile is concentrated in recurring neighborhood issues, especially around daily livability problems.";
    }

    return `This block is underperforming mainly because ${categoryName.toLowerCase()} is the dominant issue, and it is showing up often enough to pull the score down.`;
  }, [entries, panelLabel, score]);

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative rounded-lg transition-colors"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        tabIndex={0}
      >
        {entries.map(([cat, count]) => (
          <div key={cat} className="flex items-center justify-between gap-3 py-1 text-sm">
            <span className="truncate text-[color:var(--text-secondary)]">{CATEGORY_LABEL[cat]}</span>
            <span className="shrink-0 tabular-nums text-[color:var(--text-primary)]">{count}</span>
          </div>
        ))}

        {explanation && isHovered && (
          <div
            className="pointer-events-none absolute left-1/2 top-[calc(100%-0.25rem)] z-20 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--radius-md)] border border-[color:var(--border-hairline)] bg-[color:var(--surface-1)] p-4 text-sm leading-6 text-[color:var(--text-primary)]"
            style={{
              boxShadow: "var(--shadow-lg)",
              transform: "translateX(-50%)",
            }}
          >
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              Why this score?
            </p>
            <p>{explanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}
