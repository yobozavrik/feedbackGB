import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const loadStoreAnalyticsOverview = vi.fn();
const loadStoreCategoryProductAnalytics = vi.fn();
const buildStoreAnalyticsComparison = vi.fn();
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from })) }));
vi.mock("@/lib/admin/storeAnalyticsOverview", () => ({ loadStoreAnalyticsOverview }));
vi.mock("@/lib/admin/storeCategoryProductAnalytics", () => ({ loadStoreCategoryProductAnalytics }));
vi.mock("@/lib/admin/storeAnalyticsComparison", () => ({ buildStoreAnalyticsComparison }));

const endpoint = "http://localhost/api/admin/stores/analytics/comparison";

describe("store analytics comparison API", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ uid: "admin", role: "super_admin" });
    order.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    loadStoreAnalyticsOverview.mockResolvedValue({ source: "overview" });
    loadStoreCategoryProductAnalytics.mockResolvedValue({ source: "catalog" });
    buildStoreAnalyticsComparison.mockReturnValue({ status: "complete" });
  });

  it("requires super-admin before source access", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=comparison&period=7d`));
    expect(response.status).toBe(403); expect(from).not.toHaveBeenCalled();
  });

  it("uses one scope and one asOf for both readers", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=comparison&period=7d&spot_ids=2,1&comparison=previous`));
    expect(response.status).toBe(200);
    const overviewInput = loadStoreAnalyticsOverview.mock.calls[0][0];
    const catalogInput = loadStoreCategoryProductAnalytics.mock.calls[0][0];
    expect(overviewInput).toMatchObject({ spotIds: [1, 2] });
    expect(catalogInput).toMatchObject({ spotIds: [1, 2], page: 1, pageSize: 25 });
    expect(catalogInput.asOf).toBe(overviewInput.asOf);
    expect(buildStoreAnalyticsComparison).toHaveBeenCalledWith({ source: "overview" }, { source: "catalog" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rejects a view mismatch", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=overview&period=7d`));
    expect(response.status).toBe(400); expect(loadStoreAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("maps either missing read model to a generic 503", async () => {
    loadStoreCategoryProductAnalytics.mockRejectedValue(new Error("store_catalog_schema_missing"));
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=comparison&period=7d`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "store_comparison_schema_missing" });
  });
});
