import type { FunnelResponse } from "@/lib/posthog/types";

// Pure chart-data transforms and formatters for the funnel page.
// Moved verbatim from funnel-client.tsx so they are unit-testable.

export const DAY_LABELS_UA = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function formatHoursAgo(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} хв тому`;
  }
  if (hours < 24) return `${hours.toFixed(1)} год тому`;
  return `${Math.round(hours / 24)} дн тому`;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export function buildSankeyLinks(
  steps: FunnelResponse["steps"],
): SankeyLink[] {
  const links: SankeyLink[] = [];
  for (let i = 0; i < steps.length - 1; i += 1) {
    const from = steps[i];
    const to = steps[i + 1];
    if (to.count > 0) {
      links.push({
        source: from.label,
        target: to.label,
        value: to.count,
      });
    }
    if (from.dropOffCount > 0 && i > 0) {
      // Render drop-off out of step i: phantom "Відвалились" lane.
      links.push({
        source: from.label,
        target: `Відвалились після ${from.label}`,
        value: from.dropOffCount,
      });
    }
  }
  return links;
}

export interface DropOffBar {
  step: string;
  dropOff: number;
  dropOffCount: number;
}

export function buildDropOffBars(
  steps: FunnelResponse["steps"],
): DropOffBar[] {
  return steps
    .slice(1)
    .map((step) => ({
      step: step.label,
      dropOff: step.dropOffPct,
      dropOffCount: step.dropOffCount,
    }))
    .reverse();
}

export interface HeatmapCell {
  day: string;
  hour: string;
  starts: number;
  completes: number;
  dropOff: number;
}

export function buildHeatmapCells(
  heatmap: FunnelResponse["heatmap"],
): HeatmapCell[] {
  return heatmap.map((cell) => ({
    day: DAY_LABELS_UA[cell.dayOfWeek] ?? String(cell.dayOfWeek),
    hour: `${String(cell.hour).padStart(2, "0")}:00`,
    starts: cell.starts,
    completes: cell.completes,
    dropOff: cell.dropOffPct,
  }));
}

export interface FunnelTotals {
  startCount: number;
  finishCount: number;
  overallConv: number;
  totalDropOff: number;
}

export function computeFunnelTotals(
  steps: FunnelResponse["steps"],
): FunnelTotals {
  const startCount = steps[0]?.count ?? 0;
  const finishCount = steps[steps.length - 1]?.count ?? 0;
  const overallConv = startCount > 0 ? (finishCount / startCount) * 100 : 0;
  return {
    startCount,
    finishCount,
    overallConv,
    totalDropOff: startCount - finishCount,
  };
}
