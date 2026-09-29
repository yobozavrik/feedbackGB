import { describe, expect, it } from "vitest";
import { buildFoodcostMatrixProducts, foodcostMatrixCategoryOptions, foodcostMatrixDomain, foodcostMatrixFocusDomain, foodcostMatrixViewport, normalizeFoodcostMatrixTableScope, selectFoodcostMatrixRows } from "../foodcostMatrix";
import type { ProductSales } from "../posterSalesMath";

function product(overrides: Partial<ProductSales> & Pick<ProductSales, "productId" | "productName">): ProductSales {
  return { productNameConflict: false, categoryId: 10, categoryConflict: false, unit: "шт", unitConflict: false,
    weightBased: false, quantity: "1", modificationIds: [0], rows: 2, payedSumMinor: 10000,
    productProfitMinor: 5000, productProfitNettoMinor: 6000, inferredCostMinor: 5000,
    nettoInferredCostMinor: 4000, foodCostPercent: 50, nettoFoodCostPercent: 40,
    ...overrides };
}

function createMatrix(products: ProductSales[]) {
  return buildFoodcostMatrixProducts(products, [{ categoryId: 10, rows: 2, distinctProducts: 1, payedSumMinor: 10000,
    productProfitMinor: 5000, productProfitNettoMinor: 6000, inferredCostMinor: 5000, nettoInferredCostMinor: 4000,
    foodCostPercent: 50, nettoFoodCostPercent: 40 }], new Map([[10, "Піца"], [11, "Випічка"]]),
    new Set(products.map((row) => row.productId)));
}

describe("foodcost matrix read model", () => {
  it("keeps full product IDs, modification aggregates, both methods, negative profit and FC over 100%", () => {
    const all = createMatrix([
      product({ productId: 1, productName: "Маргарита", payedSumMinor: 10000, productProfitMinor: -5000,
        productProfitNettoMinor: -8000, foodCostPercent: 150, nettoFoodCostPercent: 180 }),
      product({ productId: 2, productName: "Четыре сыра", payedSumMinor: 50000, productProfitMinor: 20000,
        productProfitNettoMinor: 21000, foodCostPercent: 60, nettoFoodCostPercent: 58 }),
    ]);
    expect(all.products).toHaveLength(2);
    expect(all.products[0]).toMatchObject({ productId: 1, categoryName: "Піца", payedSumMinor: 10000,
      profitMinor: -5000, profitNettoMinor: -8000, foodCostPercent: 150, nettoFoodCostPercent: 180 });
    expect(foodcostMatrixDomain(all.products, "profit")).toMatchObject({ xMin: 0, xMax: 150, yMin: -50, yMax: 200 });
    expect(foodcostMatrixDomain(all.products, "netto")).toMatchObject({ xMin: 0, xMax: 180, yMin: -80, yMax: 210 });
  });

  it("uses the selected method for chart eligibility, while separating no-paid and null-method products", () => {
    const all = createMatrix([
      product({ productId: 1, productName: "Є продаж", foodCostPercent: 40, nettoFoodCostPercent: null, productProfitNettoMinor: null }),
      product({ productId: 2, productName: "Без продажу", payedSumMinor: 0, foodCostPercent: null, nettoFoodCostPercent: null,
        productProfitMinor: 0, productProfitNettoMinor: null }),
    ]).products;
    const profit = selectFoodcostMatrixRows(all, { method: "profit", categoryKey: "all", search: "", minimumPaidMinor: 0 });
    const netto = selectFoodcostMatrixRows(all, { method: "netto", categoryKey: "all", search: "", minimumPaidMinor: 0 });
    expect(profit.chartRows.map((row) => row.productId)).toEqual([1]);
    expect(profit.nonPositivePaid).toBe(1);
    expect(profit.missingSelectedMethod).toBe(0);
    expect(netto.chartRows).toEqual([]);
    expect(netto.nonPositivePaid).toBe(1);
    expect(netto.missingSelectedMethod).toBe(1);
    expect(netto.rows).toHaveLength(2);
  });

  it("filters only positive sales under the minimum and keeps returns/no-sale rows separately visible", () => {
    const all = createMatrix([
      product({ productId: 1, productName: "Малий продаж", payedSumMinor: 1000 }),
      product({ productId: 2, productName: "Достатній продаж", payedSumMinor: 10000 }),
      product({ productId: 3, productName: "Повернення", payedSumMinor: -1000 }),
      product({ productId: 4, productName: "Без продажу", payedSumMinor: 0 }),
    ]).products;
    const selected = selectFoodcostMatrixRows(all, { method: "profit", categoryKey: "all", search: "", minimumPaidMinor: 5000 });
    expect(selected.totalInScope).toBe(4);
    expect(selected.filteredOutByMinimum).toBe(1);
    expect(selected.rows.map((row) => row.productId).sort()).toEqual([2, 3, 4]);
    expect(selected.nonPositivePaid).toBe(2);
  });

  it("supports category and product/ID search without dropping the other row values", () => {
    const all = createMatrix([
      product({ productId: 42, productName: "Сирна", categoryId: 10 }),
      product({ productId: 43, productName: "Пепероні", categoryId: 11 }),
    ]);
    const onlyPizza = selectFoodcostMatrixRows(all.products, { method: "profit", categoryKey: "10", search: "42", minimumPaidMinor: 0 });
    expect(onlyPizza.rows.map((row) => row.productId)).toEqual([42]);
    expect(all.categories.map((row) => row.key)).toContain("11");
  });

  it("separates no category from a conflicting category assignment", () => {
    const all = createMatrix([
      product({ productId: 1, productName: "Без категорії", categoryId: null }),
      product({ productId: 2, productName: "Категорія конфлікт", categoryId: null, categoryConflict: true }),
    ]);
    expect(all.products.map((row) => row.categoryKey)).toEqual(["__unknown", "__conflict"]);
    expect(all.categories.find((row) => row.key === "__conflict")?.name).toBe("Категорія різниться у модифікаціях");
  });

  it("keeps a selected category visible when the current scope has no rows for it", () => {
    const categories = [{ key: "10", name: "Піца" }];
    expect(foodcostMatrixCategoryOptions(categories, "42")).toContainEqual({
      value: "42", label: "Категорія #42 · немає продажів у періоді",
    });
    expect(foodcostMatrixCategoryOptions(categories, "__unknown")).toContainEqual({
      value: "__unknown", label: "Без категорії · немає продажів у періоді",
    });
    expect(foodcostMatrixCategoryOptions(categories, "__conflict")).toContainEqual({
      value: "__conflict", label: "Змінювалась категорія · немає продажів у періоді",
    });
  });

  it("focuses a readable viewport but counts high-FC and positive-profit outliers without losing negative-profit points", () => {
    const all = createMatrix([
      ...Array.from({ length: 19 }, (_, index) => product({ productId: index + 1, productName: `Звичайний ${index + 1}`,
        payedSumMinor: 10000, productProfitMinor: 1000, foodCostPercent: 50 })),
      product({ productId: 20, productName: "Викид прибутку", payedSumMinor: 10000, productProfitMinor: 100000,
        foodCostPercent: 50 }),
      product({ productId: 21, productName: "Викид фудкосту та збиток", payedSumMinor: 10000, productProfitMinor: -10000,
        foodCostPercent: 150 }),
    ]).products;
    const focus = foodcostMatrixFocusDomain(all, "profit");
    expect(focus).toEqual({ xMin: 0, xMax: 100, yMin: -100, yMax: 10 });
    const focused = foodcostMatrixViewport(all, "profit", focus);
    expect(focused.visible.map((row) => row.productId)).toHaveLength(19);
    expect(focused.outside.map((row) => row.productId).sort()).toEqual([20, 21]);
    expect(all).toHaveLength(21); // Full table remains independent of chart focus.

    const full = foodcostMatrixViewport(all, "profit", foodcostMatrixDomain(all, "profit"));
    expect(full.visible).toHaveLength(21);
    expect(full.outside).toEqual([]);
  });

  it("resets an out-of-focus table filter when switching to full range", () => {
    expect(normalizeFoodcostMatrixTableScope("outside", "full")).toBe("all");
    expect(normalizeFoodcostMatrixTableScope("outside", "focus")).toBe("outside");
    expect(normalizeFoodcostMatrixTableScope("all", "full")).toBe("all");
  });
});
