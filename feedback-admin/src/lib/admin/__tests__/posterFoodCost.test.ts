import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFoodCostSample, getLiveFoodCostSample } from "../posterFoodCost";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const product = {
  product_id: "121",
  product_name: "Пельмені зі свинини",
  unit: "kg",
  weight_flag: "1",
  out: 1000,
  cost: "801",
  spots: [
    { spot_id: "1", price: "1900", profit: "1099", visible: "1" },
    { spot_id: "2", price: "2000", profit: "1199", visible: "1" },
  ],
  ingredients: [
    { structure_id: "1", ingredient_name: "Свинина", structure_type: "1", structure_brutto: 350, structure_unit: "g", structure_selfprice: "5893" },
    { structure_id: "2", ingredient_name: "Тісто", structure_type: "2", structure_brutto: 520, structure_unit: "g", structure_selfprice: "849" },
  ],
};
const spots = [{ spot_id: "1", spot_name: "Кварц" }, { spot_id: "2", spot_name: "Шкільна" }];
const settings = { currency: { currency_code_iso: "UAH", currency_symbol: "₴" } };

describe("Poster live food-cost pilot", () => {
  it("keeps minor units and calculates the ratio on the same 100 g basis", () => {
    const result = buildFoodCostSample(product, spots, settings, "2026-09-24T07:00:00Z");
    expect(result).toMatchObject({ productId: 121, costMinor: 801, priceBasis: "100g", currencyCode: "UAH" });
    expect(result.stores[0]).toMatchObject({ storeName: "Кварц", priceMinor: 1900, profitMinor: 1099, priceMatchesCostAndProfit: true });
    expect(result.stores[0].foodCostPercent).toBeCloseTo(42.1579, 3);
    expect(result.stores[1].foodCostPercent).toBeCloseTo(40.05, 2);
    expect(result.ingredientTotalMinor).toBe(6742);
    expect(result.ingredients[1].kind).toBe("prepack");
  });

  it("never turns missing cost or price into zero food cost", () => {
    const result = buildFoodCostSample({ ...product, cost: null, spots: [{ spot_id: "1", price: null, visible: "1" }] }, spots, settings, "now");
    expect(result.costMinor).toBeNull();
    expect(result.stores[0].priceMinor).toBeNull();
    expect(result.stores[0].foodCostPercent).toBeNull();
  });

  it("does not treat zero cost as reliable 0% food cost", () => {
    const result = buildFoodCostSample({ ...product, cost: "0" }, spots, settings, "now");
    expect(result.costMinor).toBe(0);
    expect(result.stores[0].foodCostPercent).toBeNull();
  });

  it("flags disagreement with the profit field instead of silently accepting it", () => {
    const result = buildFoodCostSample({ ...product, spots: [{ spot_id: "1", price: "1900", profit: "1000", visible: "1" }] }, spots, settings, "now");
    expect(result.stores[0].priceMatchesCostAndProfit).toBe(false);
  });

  it("preserves a negative Poster profit for a loss-making price", () => {
    const result = buildFoodCostSample({ ...product, spots: [{ spot_id: "1", price: "700", profit: "-101", visible: "1" }] }, spots, settings, "now");
    expect(result.stores[0]).toMatchObject({ profitMinor: -101, priceMatchesCostAndProfit: true });
    expect(result.stores[0].foodCostPercent).toBeGreaterThan(100);
  });

  it("rejects a non-weight product because the pilot's price basis differs", () => {
    expect(() => buildFoodCostSample({ ...product, weight_flag: "0" }, spots, settings, "now"))
      .toThrowError("food_cost_sample_requires_weight_kg");
  });

  it("reads the product, store names and account currency from Poster, without cache", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const method = new URL(String(input)).pathname.split("/").pop();
      const response = method === "menu.getProduct" ? product : method === "access.getSpots" ? spots : settings;
      return new Response(JSON.stringify({ response }), { status: 200 });
    }) as typeof fetch;
    const result = await getLiveFoodCostSample(121, "secret");
    expect(result.stores).toHaveLength(2);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(global.fetch).mock.calls.every(([, options]) => options?.cache === "no-store")).toBe(true);
  });

  it("keeps the live product page available when a prepack detail fails", async () => {
    const withPrepack = { ...product, ingredients: [
      product.ingredients[0], { ...product.ingredients[1], ingredient_id: "37" },
    ] };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const method = new URL(String(input)).pathname.split("/").pop();
      if (method === "menu.getPrepack") return new Response("unavailable", { status: 503 });
      const response = method === "menu.getProduct" ? withPrepack : method === "access.getSpots" ? spots : settings;
      return new Response(JSON.stringify({ response }), { status: 200 });
    }) as typeof fetch;
    const result = await getLiveFoodCostSample(121, "secret");
    expect(result.productId).toBe(121);
    expect(result.prepacks).toEqual([]);
    expect(result.ingredients[1]).toMatchObject({ kind: "prepack", ingredientId: 37 });
  });
});
