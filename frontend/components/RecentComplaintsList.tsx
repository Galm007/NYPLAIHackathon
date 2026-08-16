import { useState } from "react";
import { STATUS_LABEL, STATUS_VAR } from "@/lib/score";
import { buildComplaintTimeline } from "@/lib/mock-data";
import type { Complaint } from "@/lib/types";
import { ChevronRightIcon } from "./icons";
import { ComplaintDetailModal } from "./ComplaintDetailModal";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RecentComplaintsList({ complaints }: { complaints: Complaint[] }) {
  const [selected, setSelected] = useState<Complaint | null>(null);

  if (complaints.length === 0) {
    return (
      <p className="text-sm text-[color:var(--text-muted)]">
        No recent 311 complaints found in this radius.
      </p>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-[color:var(--gridline)]">
        {complaints.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setSelected(c)}
              className="flex w-full items-center justify-between gap-3 rounded-md py-2.5 text-left text-sm transition-colors hover:bg-[color:var(--gridline)]"
            >
              <div className="min-w-0">
                <p className="truncate text-[color:var(--text-primary)]">{c.label}</p>
                <p className="text-xs text-[color:var(--text-muted)]">{formatDate(c.date)}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"
                  style={{ color: `var(${STATUS_VAR[c.status]})` }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(${STATUS_VAR[c.status]})` }} />
                  {STATUS_LABEL[c.status]}
                </span>
                <ChevronRightIcon className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <ComplaintDetailModal
          complaint={selected}
          timeline={buildComplaintTimeline(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
