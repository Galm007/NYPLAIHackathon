import { CATEGORY_LABEL } from "@/lib/score";

export function ComplaintBreakdownBars({
  counts,
  colorVar,
}: {
  counts: Record<string, number>;
  colorVar: string;
}) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const color = `var(${colorVar})`;

  return (
    <div className="flex flex-col gap-2.5">
      {entries.map(([cat, count]) => (
        <div key={cat} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate text-[color:var(--text-secondary)]">
            {CATEGORY_LABEL[cat] ?? cat}
          </span>
          <div className="h-2 flex-1 rounded-full bg-[color:var(--gridline)]">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(4, (count / max) * 100)}%`,
                background: color,
                transition: "width 500ms ease-out",
              }}
            />
          </div>
          <span className="w-5 shrink-0 text-right tabular-nums text-[color:var(--text-primary)]">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}
