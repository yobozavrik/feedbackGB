import { posterRequest, PosterApiError } from "./posterApi";

type PosterProduct = { product_id: string; product_name: string; ingredient_id?: string };
type PosterSpot = { spot_id: string; spot_name: string; storages?: { storage_id: number }[] };
type PosterLeftover = { ingredient_id: string; storage_ingredient_left: string; ingredient_unit: string };

export type StoreStock = {
  storeId: number;
  storeName: string;
  storageId: number | null;
  quantity: number | null;
  status: "available" | "storage_mapping_missing_or_ambiguous" | "stock_row_missing" | "poster_unavailable";
};

export type ProductStock = {
  productId: number;
  productName: string;
  status: "available" | "product_without_stock_id";
  unit: string | null;
  checkedAt: string;
  stores: StoreStock[];
};

export class PosterStockError extends PosterApiError {}

export async function getLiveProductStock(productId: number, token: string): Promise<ProductStock> {
  const product = await posterRequest<PosterProduct>("menu.getProduct", { product_id: String(productId) }, token);
  if (!product || Number(product.product_id) !== productId) throw new PosterStockError("product_missing_in_poster");
  if (!product.ingredient_id || String(product.ingredient_id) === "0") {
    return { productId, productName: product.product_name, status: "product_without_stock_id", unit: null, checkedAt: new Date().toISOString(), stores: [] };
  }
  const spots = await posterRequest<PosterSpot[]>("access.getSpots", {}, token);
  if (!Array.isArray(spots)) throw new PosterStockError("poster_invalid_response");

  const stores: StoreStock[] = spots.map((spot) => ({
    storeId: Number(spot.spot_id),
    storeName: spot.spot_name.trim(),
    storageId: spot.storages?.length === 1 ? Number(spot.storages[0].storage_id) : null,
    quantity: null,
    status: "storage_mapping_missing_or_ambiguous",
  }));
  // Bounded concurrency avoids flooding Poster with 26 simultaneous requests.
  let next = 0;
  let unit: string | null = null;
  await Promise.all(Array.from({ length: Math.min(5, stores.length) }, async () => {
    while (next < stores.length) {
      const row = stores[next++];
      if (row.storageId === null) continue;
      try {
        const leftovers = await posterRequest<PosterLeftover[]>("storage.getStorageLeftovers", {
          storage_id: String(row.storageId), zero_leftovers: "true",
        }, token);
        if (!Array.isArray(leftovers)) throw new PosterStockError("poster_invalid_response");
        const match = leftovers.find((item) => String(item.ingredient_id) === String(product.ingredient_id));
        if (!match) { row.status = "stock_row_missing"; continue; }
        const quantity = Number(match.storage_ingredient_left);
        if (!Number.isFinite(quantity)) throw new PosterStockError("poster_invalid_response");
        row.quantity = quantity;
        row.status = "available";
        unit ??= match.ingredient_unit || null;
      } catch {
        row.status = "poster_unavailable";
      }
    }
  }));
  return { productId, productName: product.product_name, status: "available", unit, checkedAt: new Date().toISOString(), stores };
}
