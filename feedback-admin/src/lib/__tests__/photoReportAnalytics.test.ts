import { describe, expect, it } from "vitest";
import { buildDailySubmissionCounts, buildPhotoReportHeatmap, buildStorePhotoReportDays, recentCalendarDates } from "@/lib/photoReportAnalytics";

describe("recentCalendarDates", () => {
  it("returns an inclusive, ordered seven-day calendar interval across a month boundary", () => {
    expect(recentCalendarDates("2026-09-01", 3)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });
});

describe("buildDailySubmissionCounts", () => {
  it("uses the agreed 26 / 24–25 / 23-and-below thresholds", () => {
    const rows = (count: number) => Array.from({ length: count }, (_, key) => ({
      key,
      store: `Store ${key}`,
      submitted: true,
      reports: 1,
      photos: 1,
      sellers: [],
      lastSubmittedAt: null,
    }));
    expect(buildDailySubmissionCounts([
      { date: "2026-09-14", rows: rows(23) },
      { date: "2026-09-15", rows: rows(24) },
      { date: "2026-09-16", rows: rows(26) },
    ])).toEqual([
      { date: "2026-09-14", submittedStores: 23, level: "red" },
      { date: "2026-09-15", submittedStores: 24, level: "yellow" },
      { date: "2026-09-16", submittedStores: 26, level: "green" },
    ]);
  });
});

describe("buildPhotoReportHeatmap", () => {
  it("creates a full store-day grid from successful snapshots", () => {
    expect(buildPhotoReportHeatmap(
      [{ id: 1, name: "A" }, { id: 2, name: "B" }],
      [{
        date: "2026-09-16",
        rows: [{ key: 1, store: "A", submitted: true, reports: 1, photos: 5, sellers: ["Олена"], lastSubmittedAt: null }],
      }],
    )).toEqual([
      { date: "2026-09-16", store: "A", reports: 1, photos: 5, sellers: ["Олена"], sellers_label: "Олена", level: "one" },
      { date: "2026-09-16", store: "B", reports: 0, photos: 0, sellers: [], sellers_label: "—", level: "none" },
    ]);
  });
});

describe("buildStorePhotoReportDays", () => {
  it("keeps a successful day without a report as zero and ignores other stores", () => {
    expect(buildStorePhotoReportDays([
      {
        date: "2026-09-15",
        rows: [
          { key: 1, store: "A", submitted: true, reports: 2, photos: 8, sellers: [], lastSubmittedAt: null },
          { key: 2, store: "B", submitted: true, reports: 1, photos: 3, sellers: [], lastSubmittedAt: null },
        ],
      },
      { date: "2026-09-16", rows: [] },
    ], 1)).toEqual([
      { date: "2026-09-15", reports: 2, photos: 8, submitted: true },
      { date: "2026-09-16", reports: 0, photos: 0, submitted: false },
    ]);
  });
});
