import type { Complaint, ComplaintStatus } from "@/lib/types";

const STATUS_META: Record<ComplaintStatus, { label: string; varName: string }> = {
  closed: { label: "Closed", varName: "--status-good" },
  "in-progress": { label: "In progress", varName: "--status-warning" },
  open: { label: "Open", varName: "--status-critical" },
};

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RecentComplaintsList({ complaints }: { complaints: Complaint[] }) {
  if (complaints.length === 0) {
    return (
      <p className="text-sm text-[color:var(--text-muted)]">
        No recent 311 complaints found in this radius.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[color:var(--gridline)]">
      {complaints.map((c) => {
        const status = STATUS_META[c.status];
        return (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate text-[color:var(--text-primary)]">{c.label}</p>
              <p className="text-xs text-[color:var(--text-muted)]">{formatDate(c.date)}</p>
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs"
              style={{ color: `var(${status.varName})` }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: `var(${status.varName})` }}
              />
              {status.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
