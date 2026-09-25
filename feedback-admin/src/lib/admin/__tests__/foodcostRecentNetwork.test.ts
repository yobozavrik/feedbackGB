import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getServerSupabase: vi.fn(), posterRequest: vi.fn(), loadFoodcostOverview: vi.fn(),
  loadFoodcostSalesPeriod: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));
vi.mock("../posterApi", () => ({ posterRequest: mocked.posterRequest }));
vi.mock("../foodcostOverview", () => ({ loadFoodcostOverview: mocked.loadFoodcostOverview }));
vi.mock("../foodcostSalesRead", () => ({ loadFoodcostSalesPeriod: mocked.loadFoodcostSalesPeriod }));

import { loadFoodcostRecentBreakdown, loadFoodcostRecentNetwork } from "../foodcostRecentNetwork";

const previousPoster = process.env.POSTER_TOKEN;
const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.POSTER_TOKEN = "test-token";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  vi.clearAllMocks();
  mocked.posterRequest.mockImplementation(async (method: string) => method === "access.getSpots"
    ? [{ spot_id: "2" }, { spot_id: "1" }]
    : [{ category_id: "7", category_name: "Напівфабрикати" }]);
  mocked.getServerSupabase.mockReturnValue({ from: () => ({
    select: () => ({ order: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }) }),
  }) });
  mocked.loadFoodcostOverview.mockResolvedValue({ status: "complete", expectedCells: 6,
    completedCells: 6, missing: [], metrics: { payedSumMinor: 100 }, days: [] });
  mocked.loadFoodcostSalesPeriod.mockResolvedValue({ status: "complete", expectedCells: 6,
    completedCells: 6, missing: [], metrics: { payedSumMinor: 100 },
    categories: [{ categoryId: 7, categoryName: null, categoryNameConflict: false }], products: [] });
});
afterEach(() => {
  if (previousPoster === undefined) delete process.env.POSTER_TOKEN;
  else process.env.POSTER_TOKEN = previousPoster;
  if (previousService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
});

describe("current-roster recent network overview", () => {
  it("checks both rosters and returns a strictly labelled three-day scope", async () => {
    const result = await loadFoodcostRecentNetwork(new Date("2026-09-24T12:00:00Z"));
    expect(mocked.posterRequest).toHaveBeenCalledWith("access.getSpots", {}, "test-token");
    expect(mocked.loadFoodcostOverview).toHaveBeenCalledWith("2026-09-21", "2026-09-23", [1, 2]);
    expect(result).toMatchObject({ scope: "current_poster_roster_three_closed_days",
      historicalRosterVerified: false, spotCount: 2, expectedCells: 6, status: "complete" });
  });

  it("fails closed when Poster and v_stores disagree", async () => {
    mocked.posterRequest.mockResolvedValueOnce([{ spot_id: "1" }, { spot_id: "3" }]);
    await expect(loadFoodcostRecentNetwork(new Date("2026-09-24T12:00:00Z")))
      .rejects.toThrow("foodcost_roster_mismatch");
    expect(mocked.loadFoodcostOverview).not.toHaveBeenCalled();
  });

  it("does not query either source without both credentials", async () => {
    delete process.env.POSTER_TOKEN;
    await expect(loadFoodcostRecentNetwork()).rejects.toThrow("poster_token_missing");
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
    expect(mocked.posterRequest).not.toHaveBeenCalled();
  });

  it("uses the same verified roster for fact-backed category and product breakdowns", async () => {
    const result = await loadFoodcostRecentBreakdown(new Date("2026-09-24T12:00:00Z"));
    expect(mocked.loadFoodcostSalesPeriod).toHaveBeenCalledWith(
      ["2026-09-23", "2026-09-22", "2026-09-21"], [1, 2]);
    expect(result).toMatchObject({ status: "complete", spotCount: 2,
      dateFrom: "2026-09-21", dateTo: "2026-09-23", historicalRosterVerified: false });
    expect(result.categories?.[0]).toMatchObject({ displayName: "Напівфабрикати",
      nameSource: "current_poster_catalog" });
  });

  it("passes 7, 14, 30 and 60 closed dates through the same verified roster", async () => {
    for (const days of [7, 14, 30, 60] as const) {
      vi.clearAllMocks();
      const result = await loadFoodcostRecentBreakdown(new Date("2026-09-25T12:00:00Z"), 2, days);
      const [dates, spots] = mocked.loadFoodcostSalesPeriod.mock.calls[0];
      expect(dates).toHaveLength(days);
      expect(dates[0]).toBe("2026-09-24");
      expect(dates[days - 1]).toBe(new Date(Date.UTC(2026, 8, 25 - days)).toISOString().slice(0, 10));
      expect(spots).toEqual([2]);
      expect(result.dateFrom).toBe(dates[days - 1]);
      expect(result.dateTo).toBe(dates[0]);
    }
  });

  it("scopes one store only after checking the current Poster/v_stores roster", async () => {
    const result = await loadFoodcostRecentBreakdown(new Date("2026-09-24T12:00:00Z"), 2);
    expect(mocked.loadFoodcostSalesPeriod).toHaveBeenCalledWith(
      ["2026-09-23", "2026-09-22", "2026-09-21"], [2]);
    expect(result).toMatchObject({ spotCount: 1, spotIds: [2] });
    await expect(loadFoodcostRecentBreakdown(new Date("2026-09-24T12:00:00Z"), 999))
      .rejects.toThrow("invalid_foodcost_spot");
  });

  it("keeps categories and products unavailable when fact coverage is incomplete", async () => {
    mocked.loadFoodcostSalesPeriod.mockResolvedValueOnce({ status: "incomplete", expectedCells: 6,
      completedCells: 5, missing: [{ businessDate: "2026-09-23", spotId: 2, reason: "missing_run" }],
      metrics: null, categories: null, products: null });
    const result = await loadFoodcostRecentBreakdown(new Date("2026-09-24T12:00:00Z"));
    expect(result).toMatchObject({ status: "incomplete", metrics: null,
      categories: null, products: null });
    expect(mocked.posterRequest).not.toHaveBeenCalledWith("menu.getCategories", {}, "test-token");
  });

  it("keeps numeric categories but marks names unavailable if current Poster menu fails", async () => {
    mocked.posterRequest.mockImplementation(async (method: string) => {
      if (method === "access.getSpots") return [{ spot_id: "2" }, { spot_id: "1" }];
      throw new Error("poster_unavailable");
    });
    const result = await loadFoodcostRecentBreakdown(new Date("2026-09-24T12:00:00Z"));
    expect(result).toMatchObject({ status: "complete", currentCategoryNamesAvailable: false });
    expect(result.categories?.[0]).toMatchObject({ categoryId: 7, displayName: null, nameSource: null });
    expect(result.categoriesWithoutDisplayName).toBe(1);
  });

  it("does not mark an empty current catalog as verified category names", async () => {
    mocked.posterRequest.mockImplementation(async (method: string) => method === "access.getSpots"
      ? [{ spot_id: "2" }, { spot_id: "1" }] : []);
    const result = await loadFoodcostRecentBreakdown(new Date("2026-09-24T12:00:00Z"));
    expect(result.currentCategoryNamesAvailable).toBe(false);
    expect(result.categoriesWithoutDisplayName).toBe(1);
  });
});
