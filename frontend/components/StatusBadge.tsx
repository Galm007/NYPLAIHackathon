import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon } from "./icons";
import { BAND_LABEL, BAND_VAR } from "@/lib/score";
import type { ScoreBand } from "@/lib/types";

const ICON: Record<ScoreBand, React.ComponentType<{ className?: string }>> = {
  good: CheckCircleIcon,
  fair: AlertTriangleIcon,
  poor: XCircleIcon,
};

export function StatusBadge({ band, text }: { band: ScoreBand; text?: string }) {
  const Icon = ICON[band];
  const color = `var(${BAND_VAR[band]})`;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {text ?? BAND_LABEL[band]}
    </span>
  );
}
