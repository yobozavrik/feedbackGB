import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const loadFoodcostOverview = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/admin/foodcostOverview", () => ({ loadFoodcostOverview }));

const endpoint = "http://localhost/api/admin/technologist/food-cost/overview";

describe("foodcost overview API", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("checks super-admin access before querying any data", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?from=2026-09-10&to=2026-09-23&spot_id=1`));
    expect(response.status).toBe(403);
    expect(requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(loadFoodcostOverview).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed scope before database access", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    const { GET } = await import("../route");
    for (const query of ["", "?from=2026-09-10&to=2026-09-23", "?from=bad&to=2026-09-23&spot_id=1",
      "?from=2026-09-10&to=2026-09-23&spot_id=1x"]) {
      expect((await GET(new Request(`${endpoint}${query}`))).status).toBe(400);
    }
    expect(loadFoodcostOverview).not.toHaveBeenCalled();
  });

  it("returns source coverage and null metrics without caching an incomplete period", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    loadFoodcostOverview.mockResolvedValue({ status: "incomplete", expectedCells: 2,
      completedCells: 1, missing: [{ businessDate: "2026-09-24", spotId: 1 }], metrics: null, days: null });
    const { GET } = await import("../route");
    const response = await GET(new Request(`${endpoint}?from=2026-09-23&to=2026-09-24&spot_id=1`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ scope: "single_poster_spot", spotId: 1,
      status: "incomplete", metrics: null });
    expect(loadFoodcostOverview).toHaveBeenCalledWith("2026-09-23", "2026-09-24", [1]);
  });

  it("bounds dates and hides provider details on errors", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    const { GET } = await import("../route");
    loadFoodcostOverview.mockRejectedValueOnce(new Error("foodcost_period_too_long"));
    expect((await GET(new Request(`${endpoint}?from=2026-08-01&to=2026-09-23&spot_id=1`))).status).toBe(400);
    loadFoodcostOverview.mockRejectedValueOnce(new Error("schema_missing"));
    const response = await GET(new Request(`${endpoint}?from=2026-09-10&to=2026-09-23&spot_id=1`));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("schema_missing");
  });
});
