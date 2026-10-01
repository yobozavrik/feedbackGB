import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const loadStoreAnalyticsOverview = vi.fn();
const loadStoreCategoryProductAnalytics = vi.fn();
const loadStorePenetrationAnalytics = vi.fn();
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from })) }));
vi.mock("@/lib/admin/storeAnalyticsOverview", () => ({ loadStoreAnalyticsOverview }));
vi.mock("@/lib/admin/storeCategoryProductAnalytics", () => ({ loadStoreCategoryProductAnalytics }));
vi.mock("@/lib/admin/storePenetrationAnalytics", () => ({ loadStorePenetrationAnalytics }));

const endpoint = "http://localhost/api/admin/stores/analytics/export";
const overview = (status: "complete" | "incomplete" = "complete") => ({
  asOf: "2026-10-01T10:00:00Z", current: {
    from: "2026-09-16", to: "2026-09-22", status, expectedCells: 7, completedCells: status === "complete" ? 7 : 6,
    missingCount: status === "complete" ? 0 : 1, missing: status === "complete" ? [] : [{ date: "2026-09-22", spotId: 1 }],
    stores: status === "complete" ? [{ spotId: 1, storeName: "=SUM(A1)", revenueMinor: "12345", profitMinor: "2345", classicFoodcostPercent: "35.00" }] : [],
    receipts: { status, expectedDays: 7, completedDays: status === "complete" ? 7 : 6,
      missingDates: status === "complete" ? [] : ["2026-09-22"] },
  },
});

describe("store analytics export API", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ uid: "admin", role: "super_admin" });
    order.mockResolvedValue({ data: [{ id: 1, name: "Клуб" }], error: null });
    loadStoreAnalyticsOverview.mockResolvedValue(overview());
  });

  it("requires super-admin before reading the source", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?tab=analytics&view=stores&period=custom&from=2026-09-16&to=2026-09-22`));
    expect(response.status).toBe(403); expect(from).not.toHaveBeenCalled();
  });

  it("exports the same complete scope and neutralizes spreadsheet formulas", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?tab=analytics&view=stores&period=custom&from=2026-09-16&to=2026-09-22&spot_ids=1&comparison=off`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("stores-2026-09-16-2026-09-22.csv");
    const body = await response.text();
    expect(body).toContain('"\'=SUM(A1)"');
    expect(loadStoreAnalyticsOverview.mock.calls[0][0]).toMatchObject({ spotIds: [1], from: "2026-09-16", to: "2026-09-22" });
  });

  it("blocks partial business exports but permits quality evidence", async () => {
    loadStoreAnalyticsOverview.mockResolvedValue(overview("incomplete"));
    const { GET } = await import("../route");
    const base = `${endpoint}?tab=analytics&period=custom&from=2026-09-16&to=2026-09-22&spot_ids=1&comparison=off`;
    const blocked = await GET(new Request(`${base}&view=stores`));
    expect(blocked.status).toBe(409);
    const quality = await GET(new Request(`${base}&view=quality`));
    expect(quality.status).toBe(200);
    expect(await quality.text()).toContain("2026-09-22");
  });

  it("blocks penetration export when mapping is not complete", async () => {
    loadStorePenetrationAnalytics.mockResolvedValue({ status: "mapping_incomplete" });
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?tab=analytics&view=penetration&period=custom&from=2026-09-16&to=2026-09-22&spot_ids=1&comparison=off`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "store_penetration_export_mapping_incomplete" });
  });
});
