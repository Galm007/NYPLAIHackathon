"use client";

import { useEffect, useState } from "react";
import { AddressSearch } from "./AddressSearch";
import { MapPanel } from "./MapPanel";
import { ScorePanelCard } from "./ScorePanelCard";
import { VerdictBanner } from "./VerdictBanner";
import { fetchReport } from "@/lib/api";
import { BuildingIcon, BlockIcon } from "./icons";
import type { ReportResponse } from "@/lib/types";

export function CompareColumn({
  label,
  initialAddress,
  onAddressChange,
}: {
  label: string;
  initialAddress: string;
  onAddressChange: (address: string) => void;
}) {
  const [result, setResult] = useState<{ address: string; data: ReportResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ address: string; message: string } | null>(null);
  const address = initialAddress;

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          {label}
        </p>
        <AddressSearch
          size="sm"
          initialValue={initialAddress}
          placeholder="Enter an address to compare"
          onSelect={onAddressChange}
        />
      </div>

      {!address && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-[color:var(--text-muted)]" style={{ borderColor: "var(--border-hairline)" }}>
          Choose an address to see its scores.
        </p>
      )}

      {error && <p style={{ color: "var(--status-critical)" }}>{error}</p>}

      {address && !report && !error && (
        <div className="h-96 animate-pulse rounded-xl" style={{ background: "var(--gridline)" }} />
      )}

      {report && (
        <>
          <VerdictBanner
            buildingBand={report.buildingHealth.band}
            blockBand={report.blockQuality.band}
            address={report.address}
            borough={report.borough}
          />
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
          <MapPanel
            centerLat={report.lat}
            centerLng={report.lng}
            buildingRadiusMeters={report.buildingHealth.radiusMeters}
            blockRadiusMeters={report.blockQuality.radiusMeters}
            buildingComplaints={report.buildingHealth.recentComplaints}
            blockComplaints={report.blockQuality.recentComplaints}
          />
        </>
      )}
    </div>
  );
}
