import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const loadStorePenetrationAnalytics = vi.fn();
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from })) }));
vi.mock("@/lib/admin/storePenetrationAnalytics", () => ({ loadStorePenetrationAnalytics }));

const endpoint = "http://localhost/api/admin/stores/analytics/penetration";

describe("store penetration analytics API", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ uid: "admin", role: "super_admin" });
    order.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    loadStorePenetrationAnalytics.mockResolvedValue({ methodologyVersion: "store-penetration-v1", status: "complete" });
  });

  it("requires super-admin before source access", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=penetration&period=7d`));
    expect(response.status).toBe(403); expect(from).not.toHaveBeenCalled();
  });

  it("passes one validated scope, category and server asOf", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=penetration&period=7d&spot_ids=2,1&category_id=7`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(loadStorePenetrationAnalytics).toHaveBeenCalledOnce();
    expect(loadStorePenetrationAnalytics.mock.calls[0][0]).toMatchObject({ spotIds: [1, 2], categoryId: 7 });
    expect(loadStorePenetrationAnalytics.mock.calls[0][0].asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects the unknown-category sentinel because receipt mapping must be complete", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=penetration&period=7d&category_id=unknown`));
    expect(response.status).toBe(400); expect(loadStorePenetrationAnalytics).not.toHaveBeenCalled();
  });

  it("rejects a view mismatch", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=overview&period=7d`));
    expect(response.status).toBe(400); expect(loadStorePenetrationAnalytics).not.toHaveBeenCalled();
  });

  it("reports a missing migration without leaking database details", async () => {
    loadStorePenetrationAnalytics.mockRejectedValue(new Error("store_penetration_schema_missing"));
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?view=penetration&period=7d`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "store_penetration_schema_missing" });
  });
});
