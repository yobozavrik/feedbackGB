import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const loadStoreAnalyticsOverview = vi.fn();
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from })) }));
vi.mock("@/lib/admin/storeAnalyticsOverview", () => ({ loadStoreAnalyticsOverview }));

const endpoint = "http://localhost/api/admin/stores/analytics/overview";

describe("store analytics overview API", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ uid: "admin", role: "super_admin" });
    order.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    loadStoreAnalyticsOverview.mockResolvedValue({ methodologyVersion: "store-analytics-overview-v1" });
  });

  it("requires super-admin before reading the roster", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?period=7d&spot_ids=all`));
    expect(response.status).toBe(403);
    expect(requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects invalid or unknown scope", async () => {
    const { GET } = await import("../route");
    expect((await GET(new Request(`${endpoint}?period=7d&spot_ids=1,999`))).status).toBe(400);
    expect(loadStoreAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("passes one server-resolved asOf and selected stores to the aggregate reader", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?period=7d&spot_ids=2,1&comparison=previous&view=overview`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(loadStoreAnalyticsOverview).toHaveBeenCalledOnce();
    expect(loadStoreAnalyticsOverview.mock.calls[0][0]).toMatchObject({ spotIds: [1, 2] });
    expect(loadStoreAnalyticsOverview.mock.calls[0][0].asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reports a missing migration without leaking database details", async () => {
    loadStoreAnalyticsOverview.mockRejectedValue(new Error("store_analytics_schema_missing"));
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?period=7d&spot_ids=all`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "store_analytics_schema_missing" });
  });
});
