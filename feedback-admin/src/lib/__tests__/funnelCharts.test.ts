import { describe, expect, it } from "vitest";
import {
  buildDropOffBars,
  buildHeatmapCells,
  buildSankeyLinks,
  computeFunnelTotals,
  formatHoursAgo,
  formatPct,
} from "../funnelCharts";

const steps = [
  { label: "Старт", count: 100, dropOffCount: 0, dropOffPct: 0 },
  { label: "Категорія", count: 80, dropOffCount: 20, dropOffPct: 20 },
  { label: "Форма", count: 60, dropOffCount: 20, dropOffPct: 25 },
  { label: "Відправлено", count: 60, dropOffCount: 0, dropOffPct: 0 },
] as never[];

describe("buildSankeyLinks", () => {
  it("links consecutive steps and adds drop-off lanes for middle steps only", () => {
    const links = buildSankeyLinks(steps as never);
    expect(links).toContainEqual({ source: "Старт", target: "Категорія", value: 80 });
    expect(links).toContainEqual({ source: "Категорія", target: "Форма", value: 60 });
    // drop-off lane for step index 1 (Категорія), none for index 0
    expect(links).toContainEqual({
      source: "Категорія",
      target: "Відвалились після Категорія",
      value: 20,
    });
    expect(links.find((l) => l.source === "Старт" && l.target.startsWith("Відвалились"))).toBeUndefined();
  });
});

describe("buildDropOffBars", () => {
  it("skips the first step and reverses the order", () => {
    const bars = buildDropOffBars(steps as never);
    expect(bars.map((b) => b.step)).toEqual(["Відправлено", "Форма", "Категорія"]);
    expect(bars[2]).toEqual({ step: "Категорія", dropOff: 20, dropOffCount: 20 });
  });
});

describe("buildHeatmapCells", () => {
  it("maps day numbers to UA labels and pads hours", () => {
    const cells = buildHeatmapCells([
      { dayOfWeek: 1, hour: 9, starts: 10, completes: 7, dropOffPct: 30 },
    ] as never);
    expect(cells[0]).toEqual({
      day: "Пн",
      hour: "09:00",
      starts: 10,
      completes: 7,
      dropOff: 30,
    });
  });
});

describe("computeFunnelTotals", () => {
  it("computes conversion and drop-off from first/last steps", () => {
    expect(computeFunnelTotals(steps as never)).toEqual({
      startCount: 100,
      finishCount: 60,
      overallConv: 60,
      totalDropOff: 40,
    });
  });

  it("handles the empty funnel", () => {
    expect(computeFunnelTotals([] as never)).toEqual({
      startCount: 0,
      finishCount: 0,
      overallConv: 0,
      totalDropOff: 0,
    });
  });
});

describe("formatters", () => {
  it("formatPct", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(Number.NaN)).toBe("—");
  });

  it("formatHoursAgo thresholds", () => {
    expect(formatHoursAgo(0.5)).toBe("30 хв тому");
    expect(formatHoursAgo(5.25)).toBe("5.3 год тому");
    expect(formatHoursAgo(50)).toBe("2 дн тому");
  });
});
