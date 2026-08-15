"use client";

import { useId, useRef, useState } from "react";
import type { TrendPoint } from "@/lib/types";

const W = 320;
const H = 72;
const PAD = 6;

function monthShort(month: string) {
  const [, m] = month.split("-");
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(m)
  ];
}

export function TrendSparkline({
  data,
  colorVar,
}: {
  data: TrendPoint[];
  colorVar: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();
  const color = `var(${colorVar})`;

  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = (W - PAD * 2) / (data.length - 1);
  const points = data.map((d, i) => ({
    x: PAD + i * stepX,
    y: H - PAD - (d.count / max) * (H - PAD * 2),
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${H - PAD} L${points[0].x},${H - PAD} Z`;

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let closest = 0;
    let closestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIdx(closest);
  }

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label="Complaint trend over the last 12 months"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={PAD}
          y1={H - PAD}
          x2={W - PAD}
          y2={H - PAD}
          stroke="var(--baseline)"
          strokeWidth="1"
        />
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hovered && (
          <>
            <line
              x1={hovered.x}
              y1={PAD}
              x2={hovered.x}
              y2={H - PAD}
              stroke="var(--baseline)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <circle cx={hovered.x} cy={hovered.y} r="3.5" fill={color} stroke="var(--surface-1)" strokeWidth="1.5" />
          </>
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[color:var(--text-muted)]">
        <span>{monthShort(data[0]?.month)}</span>
        <span>{monthShort(data[data.length - 1]?.month)}</span>
      </div>
      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${(hovered.x / W) * 100}%`,
            top: `${(hovered.y / H) * 100 - 4}%`,
            background: "var(--surface-1)",
            borderColor: "var(--border-hairline)",
            color: "var(--text-primary)",
          }}
        >
          <span className="font-medium">{hovered.count}</span>{" "}
          <span className="text-[color:var(--text-muted)]">
            {monthShort(hovered.month)} {hovered.month.slice(0, 4)}
          </span>
        </div>
      )}
    </div>
  );
}
