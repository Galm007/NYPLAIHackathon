"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchReport } from "@/lib/api";
import { AddressSearch } from "./AddressSearch";
import { MapPanel } from "./MapPanel";
import { ReportSkeleton } from "./ReportSkeleton";
import { ScorePanelCard } from "./ScorePanelCard";
import { VerdictBanner } from "./VerdictBanner";
import { BuildingIcon, BlockIcon, ChevronRightIcon } from "./icons";
import type { ReportResponse } from "@/lib/types";

export function ReportView() {
  const searchParams = useSearchParams();
  const address = searchParams.get("address") ?? "";
  const [result, setResult] = useState<{ address: string; data: ReportResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ address: string; message: string } | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetchReport(address)
      .then((data) => {
        if (cancelled) return;
        setResult({ address, data });
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorState({ address, message: e.message ?? "Something went wrong" });
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const report = result?.address === address ? result.data : null;
  const error = errorState?.address === address ? errorState.message : null;

  if (!address) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <p className="text-[color:var(--text-secondary)]">
          Enter an address to see its report.
        </p>
        <div className="mt-4">
          <AddressSearch size="sm" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <p style={{ color: "var(--status-critical)" }}>{error}</p>
        <Link href="/" className="mt-3 inline-block text-sm underline text-[color:var(--text-secondary)]">
          Back to search
        </Link>
      </div>
    );
  }

  if (!report) {
    return <ReportSkeleton />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <nav className="mb-5 flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
        <Link href="/" className="hover:text-[color:var(--text-primary)]">
          Search
        </Link>
        <ChevronRightIcon className="h-3 w-3" />
        <span className="text-[color:var(--text-secondary)]">Report</span>
      </nav>

      <div className="mb-6 max-w-md">
        <AddressSearch key={report.address} size="sm" initialValue={report.address} />
      </div>

      <VerdictBanner
        buildingBand={report.buildingHealth.band}
        blockBand={report.blockQuality.band}
        address={report.address}
        borough={report.borough}
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ScorePanelCard
          icon={<BuildingIcon className="h-4.5 w-4.5" />}
          panel={report.buildingHealth}
          colorVar="--series-building"
          description="Complaints tied to this building"
        />
        <ScorePanelCard
          icon={<BlockIcon className="h-4.5 w-4.5" />}
          panel={report.blockQuality}
          colorVar="--series-block"
          description="Complaints on the surrounding block"
        />
      </div>

      <div className="mt-4">
        <MapPanel
          centerLat={report.lat}
          centerLng={report.lng}
          buildingRadiusMeters={report.buildingHealth.radiusMeters}
          blockRadiusMeters={report.blockQuality.radiusMeters}
          buildingComplaints={report.buildingHealth.recentComplaints}
          blockComplaints={report.blockQuality.recentComplaints}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-[color:var(--text-muted)]" style={{ borderColor: "var(--border-hairline)" }}>
        <span>
          Source: {report.meta.dataSource} · cached {report.meta.cacheAgeMinutes}m ago
        </span>
        <Link
          href={`/compare?a=${encodeURIComponent(report.address)}`}
          className="font-medium text-[color:var(--text-secondary)] underline-offset-2 hover:underline"
        >
          Compare with another address →
        </Link>
      </div>
    </div>
  );
}
