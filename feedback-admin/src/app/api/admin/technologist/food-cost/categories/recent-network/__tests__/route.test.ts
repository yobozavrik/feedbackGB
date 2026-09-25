import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ requireAdminSession: vi.fn(), loadFoodcostRecentBreakdown: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mocked.requireAdminSession }));
vi.mock("@/lib/admin/foodcostRecentNetwork", () => ({
  loadFoodcostRecentBreakdown: mocked.loadFoodcostRecentBreakdown,
}));

import { GET } from "../route";

beforeEach(() => {
  mocked.requireAdminSession.mockReset().mockResolvedValue({ uid: "admin" });
  mocked.loadFoodcostRecentBreakdown.mockReset().mockResolvedValue({
    scope: "current_poster_roster_three_closed_days", historicalRosterVerified: false,
    methodologyVersion: "poster-sales-dual-v1", dateFrom: "2026-09-22", dateTo: "2026-09-24",
    spotCount: 26, status: "complete", expectedCells: 78, completedCells: 78,
    missing: [], sourceFetchedAt: "2026-09-25T06:00:00Z",
    metrics: { payedSumMinor: 100 }, currentCategoryNamesAvailable: true,
    categories: [{ categoryId: 7, displayName: "Напівфабрикати",
      nameSource: "current_poster_catalog" }],
    products: [{ productId: 121, productName: "Пельмені зі свинини" }],
  });
});

describe("recent network foodcost categories API", () => {
  it("requires super-admin before reading source", async () => {
    mocked.requireAdminSession.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocked.requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(mocked.loadFoodcostRecentBreakdown).not.toHaveBeenCalled();
  });

  it("returns categories and provenance but not product rows", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "complete", expectedCells: 78,
      categories: [{ categoryId: 7, displayName: "Напівфабрикати" }] });
    expect(body.products).toBeUndefined();
  });

  it("passes through incomplete coverage with null metrics", async () => {
    mocked.loadFoodcostRecentBreakdown.mockResolvedValueOnce({ status: "incomplete",
      expectedCells: 78, completedCells: 77, missing: [{ businessDate: "2026-09-24", spotId: 26 }],
      metrics: null, categories: null, products: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "incomplete", metrics: null, categories: null });
  });

  it("does not leak provider errors", async () => {
    mocked.loadFoodcostRecentBreakdown.mockRejectedValueOnce(new Error("foodcost_roster_mismatch"))
      .mockRejectedValueOnce(new Error("secret-bearing error"));
    const unavailable = await GET();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "foodcost_source_unavailable" });
    const failure = await GET();
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: "foodcost_categories_unavailable" });
  });
});
