import { Suspense } from "react";
import { ReportSkeleton } from "@/components/ReportSkeleton";
import { ReportView } from "@/components/ReportView";

export default function ReportPage() {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <ReportView />
    </Suspense>
  );
}
