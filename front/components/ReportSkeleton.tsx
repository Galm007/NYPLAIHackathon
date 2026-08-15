export function ReportSkeleton() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse px-4 py-8 sm:px-6">
      <div className="h-28 rounded-xl" style={{ background: "var(--gridline)" }} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="h-96 rounded-xl" style={{ background: "var(--gridline)" }} />
        <div className="h-96 rounded-xl" style={{ background: "var(--gridline)" }} />
      </div>
      <div className="mt-4 h-96 rounded-xl" style={{ background: "var(--gridline)" }} />
    </div>
  );
}
