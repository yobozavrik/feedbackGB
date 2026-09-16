import type { DailyPhotoReportRow } from "@/lib/photoReport";

export interface StorePhotoReportDay {
  date: string;
  reports: number;
  photos: number;
  submitted: boolean;
}

export interface DailyPhotoReportSnapshot {
  date: string;
  rows: DailyPhotoReportRow[];
}

export interface PhotoReportHeatmapCell {
  date: string;
  store: string;
  reports: number;
  photos: number;
  sellers: string[];
  sellers_label: string;
  level: "none" | "one" | "two_or_more";
}

export interface DailySubmissionCount {
  date: string;
  submittedStores: number;
  level: "red" | "yellow" | "green";
}

/** Returns calendar dates ending on endDate, without relying on browser time zone. */
export function recentCalendarDates(endDate: string, days: number): string[] {
  const [year, month, day] = endDate.split("-").map(Number);
  if (!year || !month || !day || days < 1) return [];

  return Array.from({ length: days }, (_, index) => {
    const value = new Date(Date.UTC(year, month - 1, day - (days - 1 - index)));
    return value.toISOString().slice(0, 10);
  });
}

/** Keeps a missing store-day distinct from a failed request: callers only pass successful snapshots. */
export function buildStorePhotoReportDays(
  snapshots: DailyPhotoReportSnapshot[],
  storeId: number,
): StorePhotoReportDay[] {
  return snapshots.map(({ date, rows }) => {
    const row = rows.find((item) => item.key === storeId);
    return {
      date,
      reports: row?.reports ?? 0,
      photos: row?.photos ?? 0,
      submitted: row?.submitted ?? false,
    };
  });
}

/** Creates a complete active-store grid only from fully loaded daily snapshots. */
export function buildPhotoReportHeatmap(
  stores: { id: number; name: string }[],
  snapshots: DailyPhotoReportSnapshot[],
): PhotoReportHeatmapCell[] {
  return snapshots.flatMap(({ date, rows }) => stores.map((store) => {
    const row = rows.find((item) => item.key === store.id);
    const reports = row?.reports ?? 0;
    return {
      date,
      store: store.name,
      reports,
      photos: row?.photos ?? 0,
      sellers: row?.sellers ?? [],
      sellers_label: row?.sellers?.join(", ") || "—",
      level: reports === 0 ? "none" : reports === 1 ? "one" : "two_or_more",
    };
  }));
}

/** Daily compliance is counted as stores with at least one submitted report. */
export function buildDailySubmissionCounts(
  snapshots: DailyPhotoReportSnapshot[],
): DailySubmissionCount[] {
  return snapshots.map(({ date, rows }) => {
    const submittedStores = rows.filter((row) => row.submitted).length;
    return {
      date,
      submittedStores,
      level: submittedStores >= 26 ? "green" : submittedStores >= 24 ? "yellow" : "red",
    };
  });
}
