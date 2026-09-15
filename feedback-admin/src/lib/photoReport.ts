export interface PhotoReportStore {
  id: number;
  name: string;
  is_active: boolean;
}

export interface PhotoReportEntry {
  created_at: string;
  store_id: number | null;
  store_name: string | null;
  user_full_name: string | null;
  photo_url: string | null;
  photo_urls: unknown;
}

export interface DailyPhotoReportRow {
  key: number;
  store: string;
  submitted: boolean;
  reports: number;
  photos: number;
  sellers: string[];
  lastSubmittedAt: string | null;
}

/** Calendar day used by the operational report, explicitly in Kyiv time. */
export function kyivDay(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function countReportPhotos(entry: PhotoReportEntry): number {
  if (Array.isArray(entry.photo_urls)) return entry.photo_urls.length;
  // PostgREST normally returns jsonb arrays as arrays. Retain this defensive
  // branch so an older serialization cannot turn a valid report into zero.
  if (typeof entry.photo_urls === "string") {
    try {
      const parsed: unknown = JSON.parse(entry.photo_urls);
      if (Array.isArray(parsed)) return parsed.length;
    } catch {
      // Legacy/null value: photo_url remains the compatible one-photo source.
    }
  }
  return entry.photo_url ? 1 : 0;
}

export function buildDailyPhotoReport(
  stores: PhotoReportStore[],
  entries: PhotoReportEntry[],
  selectedDate: string,
): DailyPhotoReportRow[] {
  const byStore = new Map<number, DailyPhotoReportRow>();
  for (const store of stores) {
    byStore.set(store.id, {
      key: store.id,
      store: store.name,
      submitted: false,
      reports: 0,
      photos: 0,
      sellers: [],
      lastSubmittedAt: null,
    });
  }

  for (const entry of entries) {
    if (entry.store_id == null || kyivDay(entry.created_at) !== selectedDate) continue;
    const row = byStore.get(entry.store_id);
    // A row for an inactive/deleted/foreign store must not affect the daily
    // denominator, which is defined by the supplied active-store list.
    if (!row) continue;
    row.submitted = true;
    row.reports += 1;
    row.photos += countReportPhotos(entry);
    if (entry.user_full_name && !row.sellers.includes(entry.user_full_name)) {
      row.sellers.push(entry.user_full_name);
    }
    if (!row.lastSubmittedAt || entry.created_at > row.lastSubmittedAt) {
      row.lastSubmittedAt = entry.created_at;
    }
  }

  return Array.from(byStore.values()).sort(
    (a, b) => Number(a.submitted) - Number(b.submitted) || a.store.localeCompare(b.store, "uk"),
  );
}
