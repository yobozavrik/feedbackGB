const POSTER_API = "https://joinposter.com/api/";

type PosterProduct = { product_id: string; product_name: string; ingredient_id?: string };
type PosterSpot = { spot_id: string; spot_name: string; storages?: { storage_id: number }[] };
type PosterLeftover = { ingredient_id: string; storage_ingredient_left: string; ingredient_unit: string };

export type StoreStock = {
  storeId: number;
  storeName: string;
  storageId: number | null;
  quantity: number | null;
  status: "ok" | "missing_storage" | "missing_product" | "error";
};

export type ProductStock = {
  productId: number;
  productName: string;
  unit: string | null;
  checkedAt: string;
  stores: StoreStock[];
};

export class PosterStockError extends Error {
  constructor(public code: string) { super(code); }
}

async function posterGet<T>(method: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(method, POSTER_API);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // Never include the URL (it contains the secret) in errors or logs.
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new PosterStockError("poster_unavailable");
  }
  if (!response.ok) throw new PosterStockError("poster_unavailable");
  let body: { response?: T; error?: unknown };
  try { body = await response.json(); } catch { throw new PosterStockError("poster_invalid_response"); }
  if (body.error || !body.response) throw new PosterStockError("poster_invalid_response");
  return body.response;
}

export async function getLiveProductStock(productId: number, token: string): Promise<ProductStock> {
  const [product, spots] = await Promise.all([
    posterGet<PosterProduct>("menu.getProduct", { product_id: String(productId) }, token),
    posterGet<PosterSpot[]>("access.getSpots", {}, token),
  ]);
  if (!product || Number(product.product_id) !== productId) throw new PosterStockError("product_not_found");
  if (!product.ingredient_id) throw new PosterStockError("product_without_stock_id");
  if (!Array.isArray(spots)) throw new PosterStockError("poster_invalid_response");

  const stores: StoreStock[] = spots.map((spot) => ({
    storeId: Number(spot.spot_id),
    storeName: spot.spot_name.trim(),
    storageId: spot.storages?.length === 1 ? Number(spot.storages[0].storage_id) : null,
    quantity: null,
    status: "missing_storage",
  }));
  // Bounded concurrency avoids flooding Poster with 26 simultaneous requests.
  let next = 0;
  let unit: string | null = null;
  await Promise.all(Array.from({ length: Math.min(5, stores.length) }, async () => {
    while (next < stores.length) {
      const row = stores[next++];
      if (row.storageId === null) continue;
      try {
        const leftovers = await posterGet<PosterLeftover[]>("storage.getStorageLeftovers", {
          storage_id: String(row.storageId), zero_leftovers: "true",
        }, token);
        if (!Array.isArray(leftovers)) throw new PosterStockError("poster_invalid_response");
        const match = leftovers.find((item) => String(item.ingredient_id) === String(product.ingredient_id));
        if (!match) { row.status = "missing_product"; continue; }
        const quantity = Number(match.storage_ingredient_left);
        if (!Number.isFinite(quantity)) throw new PosterStockError("poster_invalid_response");
        row.quantity = quantity;
        row.status = "ok";
        unit ??= match.ingredient_unit || null;
      } catch {
        row.status = "error";
      }
    }
  }));
  return { productId, productName: product.product_name, unit, checkedAt: new Date().toISOString(), stores };
}
