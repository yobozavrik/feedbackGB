import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getServerSupabase: vi.fn(),
  loadFoodcostRecentBreakdown: vi.fn(),
  loadFoodcostSalesPeriod: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));
vi.mock("../foodcostRecentNetwork", () => ({ loadFoodcostRecentBreakdown: mocked.loadFoodcostRecentBreakdown }));
vi.mock("../foodcostSalesRead", () => ({ loadFoodcostSalesPeriod: mocked.loadFoodcostSalesPeriod }));
import { buildCommandCenterView, loadFoodcostCommandCenter } from "../foodcostCommandCenter";
import { foodcostPeriodWindows } from "../foodcostPeriod";

type Recent = Parameters<typeof buildCommandCenterView>[0];

function categoryRow(categoryId: number, payedSumMinor: number, productProfitMinor: number,
  productProfitNettoMinor: number, distinctProducts = 1) {
  return { categoryId, displayName: categoryId === 1 ? "А" : "Б", categoryName: categoryId === 1 ? "А" : "Б",
    categoryNameConflict: false, nameSource: "sales_snapshot", rows: 1, distinctProducts,
    payedSumMinor, productProfitMinor, productProfitNettoMinor,
    inferredCostMinor: payedSumMinor - productProfitMinor,
    nettoInferredCostMinor: payedSumMinor - productProfitNettoMinor,
    foodCostPercent: (payedSumMinor - productProfitMinor) / payedSumMinor * 100,
    nettoFoodCostPercent: (payedSumMinor - productProfitNettoMinor) / payedSumMinor * 100 };
}

function completeRecent(): Recent {
  return {
    status: "complete", historicalRosterVerified: false,
    dateFrom: "2026-09-22", dateTo: "2026-09-24", spotCount: 2,
    expectedCells: 6, completedCells: 6, sourceFetchedAt: "2026-09-25T01:00:00Z",
    newestSourceFetchedAt: "2026-09-25T02:00:00Z",
    metrics: { payedSumMinor: 40000, productProfitMinor: 30000, productProfitNettoMinor: 32000,
      inferredCostMinor: 10000, nettoInferredCostMinor: 8000, foodCostPercent: 25,
      nettoFoodCostPercent: 20 },
    productsByDate: [
      { businessDate: "2026-09-24", products: [{ productId: 122, categoryId: 1, categoryConflict: false, payedSumMinor: 30000,
        productProfitMinor: 24000, productProfitNettoMinor: 25500 }] },
      { businessDate: "2026-09-22", products: [{ productId: 121, categoryId: 2, categoryConflict: false, payedSumMinor: 10000,
        productProfitMinor: 6000, productProfitNettoMinor: 6500 }] },
      { businessDate: "2026-09-23", products: [] },
    ],
    categories: [
      categoryRow(2, 10000, 6000, 6500),
      categoryRow(1, 30000, 24000, 25500),
    ],
    categoriesByDate: [
      { businessDate: "2026-09-24", categories: [categoryRow(1, 30000, 24000, 25500)],
        productIdsByCategory: [{ categoryId: 1, productIds: [122] }] },
      { businessDate: "2026-09-22", categories: [categoryRow(2, 10000, 6000, 6500)],
        productIdsByCategory: [{ categoryId: 2, productIds: [121] }] },
      { businessDate: "2026-09-23", categories: [], productIdsByCategory: [] },
    ],
    products: [
      { productId: 121, productName: "Товар 121", payedSumMinor: 10000,
        foodCostPercent: 40, nettoFoodCostPercent: 35 },
      { productId: 122, productName: "Товар 122", payedSumMinor: 30000,
        foodCostPercent: 20, nettoFoodCostPercent: 15 },
    ],
  } as unknown as Recent;
}

describe("foodcost A1 command-center read model", () => {
  beforeEach(() => {
    mocked.getServerSupabase.mockReset();
    mocked.loadFoodcostRecentBreakdown.mockReset();
    mocked.loadFoodcostSalesPeriod.mockReset();
  });

  it("derives cards, days and ranked lists from the same complete snapshot", () => {
    const result = buildCommandCenterView(completeRecent(), new Set([121]));
    expect(result).toMatchObject({ status: "complete", expectedCells: 6, completedCells: 6,
      metrics: { payedSumMinor: 40000, foodCostPercent: 25, nettoFoodCostPercent: 20 } });
    expect(result.days?.map((day) => day.businessDate)).toEqual([
      "2026-09-22", "2026-09-23", "2026-09-24",
    ]);
    expect(result.days?.map((day) => day.metrics.foodCostPercent)).toEqual([40, null, 20]);
    expect(result.categories?.map((row) => row.categoryId)).toEqual([1, 2]);
    expect(result.products?.map((row) => row.productId)).toEqual([122, 121]);
    expect(result.products?.map((row) => row.currentCatalogPresent)).toEqual([false, true]);
    expect(result.attention?.categories).toEqual([]);
    expect(result.attention?.products).toEqual([]);
    expect(result.heatmap?.bins.map((bin) => bin.from)).toEqual([
      "2026-09-22", "2026-09-23", "2026-09-24",
    ]);
  });

  it("prioritizes data quality, shows red items by either method, and excludes zero-paid/unknown-FC rows", () => {
    const recent = completeRecent();
    recent.metrics!.productProfitNettoMinor = null;
    const baseCategory = recent.categories![0];
    const baseProduct = recent.products![0];
    recent.categories = [
      { ...baseCategory, categoryId: 8, displayName: "Червона категорія", payedSumMinor: 25000,
        foodCostPercent: 46, nettoFoodCostPercent: 44 },
      { ...baseCategory, categoryId: 9, displayName: "Невідомий показник", payedSumMinor: 22000,
        foodCostPercent: null, nettoFoodCostPercent: 44 },
      { ...baseCategory, categoryId: 10, displayName: "Без обороту", payedSumMinor: 0,
        foodCostPercent: 80, nettoFoodCostPercent: 80 },
    ];
    recent.products = [
      { ...baseProduct, productId: 500, productName: "За другою методикою", payedSumMinor: 30000,
        foodCostPercent: 44, nettoFoodCostPercent: 46 },
      { ...baseProduct, productId: 501, productName: "За першою методикою", payedSumMinor: 20000,
        foodCostPercent: 47, nettoFoodCostPercent: 30 },
      { ...baseProduct, productId: 502, productName: "Нульовий оборот", payedSumMinor: 0,
        foodCostPercent: 90, nettoFoodCostPercent: 90 },
    ];
    const result = buildCommandCenterView(recent, new Set([500]));

    expect(result.attention?.quality.map((issue) => issue.code)).toEqual([
      "netto_unavailable", "historical_roster_unconfirmed",
    ]);
    expect(result.attention?.categories.map((row) => row.categoryId)).toEqual([8]);
    expect(result.attention?.categories[0].redMethods).toEqual(["profit"]);
    expect(result.attention?.products.map((row) => row.productId)).toEqual([500, 501]);
    expect(result.attention?.products.map((row) => row.redMethods)).toEqual([["netto"], ["profit"]]);
    expect(result.attention?.products[0].currentCatalogPresent).toBe(true);
    expect(result.attention?.products[1].currentCatalogPresent).toBe(false);
  });

  it("looks up catalog presence for a red product outside the paid top 12", async () => {
    const now = new Date("2026-09-25T00:30:00.000Z");
    const windows = foodcostPeriodWindows(7, now);
    const recent = completeRecent();
    recent.allSpotIds = [1, 2];
    recent.dateFrom = windows.current.from;
    recent.dateTo = windows.current.to;
    recent.expectedCells = 14;
    recent.completedCells = 14;
    const baseProduct = recent.products![0];
    recent.products = Array.from({ length: 13 }, (_, index) => ({
      ...baseProduct,
      productId: index + 1,
      productName: `Товар ${index + 1}`,
      payedSumMinor: 13 - index,
      foodCostPercent: index === 12 ? 50 : 25,
      nettoFoodCostPercent: 20,
    }));
    // This red row is intentionally below all twelve higher-paid rows.
    mocked.loadFoodcostRecentBreakdown.mockResolvedValueOnce(recent);
    mocked.loadFoodcostSalesPeriod.mockResolvedValueOnce({ status: "complete", expectedCells: 14,
      completedCells: 14, metrics: completeRecent().metrics, missing: [] });
    const catalogLookups: number[][] = [];
    mocked.getServerSupabase.mockReturnValue({ from: (table: string) => table === "v_stores"
      ? { select: () => ({ order: async () => ({ data: [{ id: 1, name: "А" }, { id: 2, name: "Б" }], error: null }) }) }
      : { select: () => ({ in: (_column: string, ids: number[]) => {
        catalogLookups.push(ids);
        return { limit: async () => ({ data: ids.map((id) => ({ id })), error: null }) };
      } }) } });

    const result = await loadFoodcostCommandCenter(undefined, 7, now);
    expect(result.products?.map((row) => row.productId)).not.toContain(13);
    expect(catalogLookups.flat()).toContain(13);
    expect(result.attention?.products).toMatchObject([{ productId: 13, currentCatalogPresent: true,
      redMethods: ["profit"] }]);
  });

  it("fails closed for incomplete coverage without keeping misleading ranked rows", () => {
    const result = buildCommandCenterView({ ...completeRecent(), status: "incomplete",
      completedCells: 5 }, new Set([121]));
    expect(result).toMatchObject({ status: "incomplete", completedCells: 5, metrics: null,
      categories: null, products: null, days: null, heatmap: null, attention: null });
  });

  it("does not invent a netto result when a daily field is missing", () => {
    const recent = completeRecent();
    recent.productsByDate![0].products[0].productProfitNettoMinor = null;
    const result = buildCommandCenterView(recent, new Set());
    expect(result.days?.[2].metrics.nettoFoodCostPercent).toBeNull();
  });

  it("uses one as-of bound and the same current roster for both equal windows", async () => {
    const now = new Date("2026-09-25T00:30:00.000Z");
    const asOf = now.toISOString();
    const windows = foodcostPeriodWindows(7, now);
    const recent = { ...completeRecent(), allSpotIds: [1, 2], dateFrom: windows.current.from,
      dateTo: windows.current.to, expectedCells: 14, completedCells: 14 } as Recent;
    mocked.loadFoodcostRecentBreakdown.mockResolvedValueOnce(recent);
    mocked.loadFoodcostSalesPeriod.mockResolvedValueOnce({ status: "complete", expectedCells: 14,
      completedCells: 14, metrics: completeRecent().metrics, missing: [] });
    mocked.getServerSupabase.mockReturnValue({ from: (table: string) => table === "v_stores"
      ? { select: () => ({ order: async () => ({ data: [{ id: 1, name: "А" }, { id: 2, name: "Б" }], error: null }) }) }
      : { select: () => ({ in: () => ({ limit: async () => ({ data: [{ id: 121 }, { id: 122 }], error: null }) }) }) } });

    const result = await loadFoodcostCommandCenter(undefined, 7, now);
    expect(mocked.loadFoodcostRecentBreakdown).toHaveBeenCalledWith(now, undefined, 7, { asOf });
    expect(mocked.loadFoodcostSalesPeriod).toHaveBeenCalledWith(windows.previous.dates, [1, 2], asOf);
    expect(result.comparison).toMatchObject({ asOf, current: { status: "complete" }, previous: { status: "complete" } });
  });

  it("does not load or publish a previous-period comparison when current coverage is incomplete", async () => {
    const now = new Date("2026-09-25T00:30:00.000Z");
    const recent = { ...completeRecent(), status: "incomplete", expectedCells: 52,
      completedCells: 26, allSpotIds: [1, 2], metrics: null, categories: null,
      products: null, productsByDate: null, categoriesByDate: null } as unknown as Recent;
    mocked.loadFoodcostRecentBreakdown.mockResolvedValueOnce(recent);
    mocked.getServerSupabase.mockReturnValue({ from: () => ({
      select: () => ({ order: async () => ({ data: [{ id: 1, name: "А" }, { id: 2, name: "Б" }], error: null }) }),
    }) });
    const result = await loadFoodcostCommandCenter(undefined, 14, now);
    expect(mocked.loadFoodcostSalesPeriod).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "incomplete", metrics: null,
      comparison: { current: { status: "incomplete", metrics: null },
        previous: { status: "incomplete", metrics: null, reasonCode: "not_evaluated" } } });
  });
});
