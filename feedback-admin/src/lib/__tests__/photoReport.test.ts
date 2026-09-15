import { describe, expect, it } from "vitest";
import {
  buildDailyPhotoReport,
  countReportPhotos,
  kyivDay,
  type PhotoReportEntry,
  type PhotoReportStore,
} from "../photoReport";

const stores: PhotoReportStore[] = [
  { id: 1, name: "Магазин 1", is_active: true },
  { id: 2, name: "Магазин 2", is_active: true },
];

function entry(overrides: Partial<PhotoReportEntry>): PhotoReportEntry {
  return {
    created_at: "2026-09-15T08:00:00.000Z",
    store_id: 1,
    store_name: "Магазин 1",
    user_full_name: "Олена",
    photo_url: "sb:one.jpg",
    photo_urls: ["sb:one.jpg"],
    ...overrides,
  };
}

describe("photo report aggregation", () => {
  it("keeps every active store and puts missing reports first", () => {
    const rows = buildDailyPhotoReport(stores, [entry({ photo_urls: ["1", "2", "3"] })], "2026-09-15");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 2, submitted: false, photos: 0, reports: 0 });
    expect(rows[1]).toMatchObject({ key: 1, submitted: true, photos: 3, reports: 1, sellers: ["Олена"] });
  });

  it("aggregates reports, photo counts and unique senders for one Kyiv day", () => {
    const rows = buildDailyPhotoReport(
      stores,
      [
        entry({ photo_urls: ["1", "2"], user_full_name: "Олена", created_at: "2026-09-15T08:00:00.000Z" }),
        entry({ photo_urls: ["3", "4", "5"], user_full_name: "Марія", created_at: "2026-09-15T10:15:00.000Z" }),
        entry({ photo_urls: ["6"], user_full_name: "Олена", created_at: "2026-09-15T11:30:00.000Z" }),
      ],
      "2026-09-15",
    );
    const storeOne = rows.find((row) => row.key === 1)!;
    expect(storeOne).toMatchObject({ submitted: true, reports: 3, photos: 6, sellers: ["Олена", "Марія"], lastSubmittedAt: "2026-09-15T11:30:00.000Z" });
  });

  it("uses Kyiv calendar boundaries, not raw UTC dates", () => {
    expect(kyivDay("2026-09-14T20:59:00.000Z")).toBe("2026-09-14");
    expect(kyivDay("2026-09-14T21:10:00.000Z")).toBe("2026-09-15");
    const rows = buildDailyPhotoReport(
      stores,
      [entry({ created_at: "2026-09-14T20:59:00.000Z" }), entry({ created_at: "2026-09-14T21:10:00.000Z" })],
      "2026-09-15",
    );
    expect(rows.find((row) => row.key === 1)?.reports).toBe(1);
  });

  it("counts legacy single-photo and serialized json photo arrays", () => {
    expect(countReportPhotos(entry({ photo_urls: null, photo_url: "sb:one.jpg" }))).toBe(1);
    expect(countReportPhotos(entry({ photo_urls: '["a","b"]', photo_url: null }))).toBe(2);
  });
});
