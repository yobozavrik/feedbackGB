import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ requireAdminSession: vi.fn(),
  loadFoodcostRecentBreakdown: vi.fn(), getServerSupabase: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mocked.requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));
vi.mock("@/lib/admin/foodcostRecentNetwork", () => ({
  loadFoodcostRecentBreakdown: mocked.loadFoodcostRecentBreakdown,
}));

import { GET } from "../route";

const url = "http://localhost/api/admin/technologist/food-cost/products/recent-network";
const request = (search = "") => new Request(`${url}${search}`);
const metrics = (paid: number, profit: number) => ({ payedSumMinor: paid,
  productProfitMinor: profit, productProfitNettoMinor: profit,
  inferredCostMinor: paid - profit, nettoInferredCostMinor: paid - profit,
  foodCostPercent: (paid - profit) / paid * 100,
  nettoFoodCostPercent: (paid - profit) / paid * 100 });

beforeEach(() => {
  mocked.requireAdminSession.mockReset().mockResolvedValue({ uid: "admin" });
  mocked.getServerSupabase.mockReset().mockReturnValue({ from: () => ({ select: () => ({
    in: () => ({ limit: async () => ({ data: [{ id: 121 }], error: null }) }),
  }) }) });
  mocked.loadFoodcostRecentBreakdown.mockReset().mockResolvedValue({
    scope: "current_poster_roster_three_closed_days", historicalRosterVerified: false,
    methodologyVersion: "poster-sales-dual-v1", dateFrom: "2026-09-22", dateTo: "2026-09-24",
    spotCount: 26, status: "complete", expectedCells: 78, completedCells: 78,
    missing: [], sourceFetchedAt: "2026-09-25T06:00:00Z",
    categories: [{ categoryId: 6, displayName: "Пельмені", nameSource: "current_poster_catalog" }],
    products: [{ productId: 121, productName: "Пельмені зі свинини", categoryId: 6,
      categoryConflict: false, productNameConflict: false, ...metrics(10000, 6000) },
      { productId: 122, productName: "Вареники", categoryId: 5,
        categoryConflict: false, productNameConflict: false, ...metrics(20000, 14000) }],
  });
});

describe("recent network foodcost products API", () => {
  it("checks super-admin before parsing or reading", async () => {
    mocked.requireAdminSession.mockResolvedValueOnce(null);
    const response = await GET(request("?page=bad"));
    expect(response.status).toBe(403);
    expect(mocked.requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(mocked.loadFoodcostRecentBreakdown).not.toHaveBeenCalled();
  });

  it("rejects invalid parameters without source access", async () => {
    const response = await GET(request("?pageSize=999"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
    expect(mocked.loadFoodcostRecentBreakdown).not.toHaveBeenCalled();
  });

  it("filters and paginates verified aggregates with no-store", async () => {
    const response = await GET(request("?q=%D0%BF%D0%B5%D0%BB%D1%8C&pageSize=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "complete", totalProducts: 1,
      filteredMetrics: { payedSumMinor: 10000, foodCostPercent: 40 },
      products: [{ productId: 121, currentCatalogPresent: true }] });
    expect(body.products[0].source_row_no).toBeUndefined();
  });

  it("never responds with partial product totals", async () => {
    mocked.loadFoodcostRecentBreakdown.mockResolvedValueOnce({ status: "incomplete",
      expectedCells: 78, completedCells: 77, missing: [], products: null, categories: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "incomplete", products: null,
      filteredMetrics: null, totalProducts: null });
  });

  it("sanitizes provider and internal errors", async () => {
    mocked.loadFoodcostRecentBreakdown.mockRejectedValueOnce(new Error("foodcost_roster_mismatch"))
      .mockRejectedValueOnce(new Error("secret-bearing internal failure"));
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "foodcost_source_unavailable" });
    const failed = await GET(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "foodcost_products_unavailable" });
  });

  it("keeps a historical product but disables its current-catalog link", async () => {
    mocked.getServerSupabase.mockReturnValueOnce({ from: () => ({ select: () => ({
      in: () => ({ limit: async () => ({ data: [], error: null }) }),
    }) }) });
    const response = await GET(request("?q=%D0%BF%D0%B5%D0%BB%D1%8C"));
    expect(response.status).toBe(200);
    expect((await response.json()).products[0].currentCatalogPresent).toBe(false);
  });
});
