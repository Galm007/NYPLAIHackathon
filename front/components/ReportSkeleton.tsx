import { SpinnerIcon } from "./icons";

export function ReportSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex justify-center py-6">
        <SpinnerIcon className="h-8 w-8 text-[color:var(--brand)]" />
      </div>
      <div className="animate-pulse">
        <div className="h-28 rounded-xl" style={{ background: "var(--gridline)" }} />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="h-96 rounded-xl" style={{ background: "var(--gridline)" }} />
          <div className="h-96 rounded-xl" style={{ background: "var(--gridline)" }} />
        </div>
        <div className="mt-4 h-96 rounded-xl" style={{ background: "var(--gridline)" }} />
      </div>
    </div>
  );
}
