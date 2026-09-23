import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveProductTechCard } from "../posterTechCard";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockPoster(responses: Record<string, unknown>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${url.pathname.split("/").pop()}:${url.searchParams.get("product_id")}`;
    const value = responses[key];
    if (value === "error") throw new Error("network failure");
    return new Response(JSON.stringify({ response: value ?? [] }), { status: 200 });
  }) as typeof fetch;
}

describe("live Poster technical card", () => {
  it("reads brutto/netto as-is and expands a semi-finished recipe", async () => {
    mockPoster({
      "menu.getProduct:121": { product_id: "121", product_name: "Пельмені зі свинини", out: 1000, ingredients: [
        { ingredient_id: "76", ingredient_name: "Сіль", structure_type: "1", structure_brutto: 5, structure_netto: 0, structure_unit: "g" },
        { ingredient_id: "37", ingredient_name: "Тісто", structure_type: "2", structure_brutto: 520, structure_netto: 500, structure_unit: "g" },
      ] },
      "menu.getPrepack:37": { product_id: "37", product_name: "Тісто", out: 1001, ingredients: [
        { ingredient_id: "25", ingredient_name: "Борошно", structure_type: "1", structure_brutto: 700, structure_netto: 625, structure_unit: "g" },
      ] },
    });
    const card = await getLiveProductTechCard(121, "secret");
    expect(card.status).toBe("recipe_available");
    expect(card.recipe.output).toBe(1000);
    expect(card.recipe.ingredients[0]).toMatchObject({ brutto: 5, netto: 0, unit: "g" });
    expect(card.recipe.ingredients[1]).toMatchObject({ kind: "prepack", brutto: 520, netto: 500, prepackStatus: "ok" });
    expect(card.recipe.ingredients[1].prepack?.ingredients[0]).toMatchObject({ brutto: 700, netto: 625 });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
  });

  it("does not fabricate missing nested ingredients", async () => {
    mockPoster({
      "menu.getProduct:121": { product_id: "121", ingredients: [{ ingredient_id: "37", structure_type: "2", structure_brutto: 520 }] },
      "menu.getPrepack:37": "error",
    });
    const card = await getLiveProductTechCard(121, "secret");
    expect(card.recipe.ingredients[0]).toMatchObject({ prepack: null, prepackStatus: "unavailable", netto: null });
  });

  it("guards against cyclic semi-finished cards", async () => {
    mockPoster({
      "menu.getProduct:121": { product_id: "121", ingredients: [{ ingredient_id: "37", structure_type: "2" }] },
      "menu.getPrepack:37": { product_id: "37", ingredients: [{ ingredient_id: "37", structure_type: "2" }] },
    });
    const card = await getLiveProductTechCard(121, "secret");
    expect(card.recipe.ingredients[0].prepack?.ingredients[0].prepackStatus).toBe("cycle");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
  });

  it("falls back to menu.getPrepack for a semi-finished product card", async () => {
    mockPoster({ "menu.getPrepack:37": { product_id: "37", product_name: "Тісто", ingredients: [] } });
    const card = await getLiveProductTechCard(37, "secret");
    expect(card.recipe.name).toBe("Тісто");
  });

  it("distinguishes a missing recipe from a product with an empty composition", async () => {
    mockPoster({ "menu.getProduct:121": { product_id: "121", ingredients: [] } });
    expect(await getLiveProductTechCard(121, "secret")).toMatchObject({ status: "recipe_not_configured", recipe: { ingredients: [] } });
    await expect(getLiveProductTechCard(999, "secret")).rejects.toMatchObject({ code: "product_missing_in_poster" });
  });
});
