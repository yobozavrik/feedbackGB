import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ requireAdminSession: vi.fn(), loadFoodcostRecentNetwork: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mocked.requireAdminSession }));
vi.mock("@/lib/admin/foodcostRecentNetwork", () => ({
  loadFoodcostRecentNetwork: mocked.loadFoodcostRecentNetwork,
}));

import { GET } from "../route";

beforeEach(() => {
  mocked.requireAdminSession.mockReset().mockResolvedValue({ uid: "admin" });
  mocked.loadFoodcostRecentNetwork.mockReset().mockResolvedValue({
    scope: "current_poster_roster_three_closed_days", historicalRosterVerified: false,
    status: "complete", expectedCells: 78, completedCells: 78, metrics: { payedSumMinor: 100 },
  });
});

describe("recent network foodcost API", () => {
  it("checks super-admin before touching sources", async () => {
    mocked.requireAdminSession.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocked.requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(mocked.loadFoodcostRecentNetwork).not.toHaveBeenCalled();
  });

  it("returns only the current roster scope without browser caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ historicalRosterVerified: false,
      expectedCells: 78, completedCells: 78 });
  });

  it("hides internal provider errors", async () => {
    mocked.loadFoodcostRecentNetwork.mockRejectedValueOnce(new Error("foodcost_roster_mismatch"))
      .mockRejectedValueOnce(new Error("secret-bearing internal message"));
    const missing = await GET();
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "foodcost_source_unavailable" });
    const internal = await GET();
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ error: "foodcost_overview_unavailable" });
  });
});
