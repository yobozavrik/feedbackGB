import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveProductStock } from "../posterStock";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockPoster(leftovers: Record<string, unknown>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const method = url.pathname.split("/").pop();
    const response = method === "menu.getProduct"
      ? { product_id: "121", product_name: "Пельмені зі свинини", ingredient_id: "323" }
      : method === "access.getSpots"
        ? [
          { spot_id: "1", spot_name: "Кварц", storages: [{ storage_id: 3 }] },
          { spot_id: "2", spot_name: "Шкільна", storages: [{ storage_id: 8 }] },
          { spot_id: "3", spot_name: "Без складу", storages: [] },
        ]
        : leftovers[url.searchParams.get("storage_id") ?? ""];
    if (response === "error") throw new Error("network failure");
    return new Response(JSON.stringify({ response }), { status: 200 });
  }) as typeof fetch;
}

describe("live Poster product stock", () => {
  it("uses storage_ingredient_left, not global ingredient_left, and preserves zero", async () => {
    mockPoster({
      "3": [{ ingredient_id: "323", ingredient_left: "750.834", storage_ingredient_left: "0", ingredient_unit: "kg" }],
      "8": [{ ingredient_id: "323", ingredient_left: "750.834", storage_ingredient_left: "22.073", ingredient_unit: "kg" }],
    });
    const result = await getLiveProductStock(121, "secret");
    expect(result.stores.map((row) => row.quantity)).toEqual([0, 22.073, null]);
    expect(result.stores.map((row) => row.status)).toEqual(["ok", "ok", "missing_storage"]);
    expect(result.unit).toBe("kg");
    expect(vi.mocked(global.fetch).mock.calls.every(([url]) => new URL(String(url)).searchParams.get("zero_leftovers") === "true" || !String(url).includes("storage.getStorageLeftovers"))).toBe(true);
  });

  it("does not report missing and failed stock as zero; preserves negatives", async () => {
    mockPoster({
      "3": [],
      "8": [{ ingredient_id: "323", storage_ingredient_left: "-1.25", ingredient_unit: "kg" }],
    });
    const result = await getLiveProductStock(121, "secret");
    expect(result.stores[0]).toMatchObject({ quantity: null, status: "missing_product" });
    expect(result.stores[1]).toMatchObject({ quantity: -1.25, status: "ok" });
  });

  it("isolates one failed warehouse", async () => {
    mockPoster({ "3": "error", "8": [{ ingredient_id: "323", storage_ingredient_left: "2", ingredient_unit: "kg" }] });
    const result = await getLiveProductStock(121, "secret");
    expect(result.stores[0].status).toBe("error");
    expect(result.stores[1].quantity).toBe(2);
  });
});
