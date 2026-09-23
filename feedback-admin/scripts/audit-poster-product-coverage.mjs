/** Read-only catalog / Poster coverage audit. Run from feedback-admin: node scripts/audit-poster-product-coverage.mjs */
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());
const token = process.env.POSTER_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!token || !supabaseUrl || !serviceKey) {
  process.stderr.write("Required Poster/Supabase server credentials are not configured.\n");
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }, db: { schema: "feedbackgb" },
});

async function posterGet(method, params = {}) {
  const url = new URL(`https://joinposter.com/api/${method}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try { response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error(`${method}: request failed`); }
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error(`${method}: invalid JSON`); }
  if (body.error || !Array.isArray(body.response)) throw new Error(`${method}: invalid response`);
  return body.response;
}

async function catalogRows() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("v_products").select("id,name").order("id").range(offset, offset + 999);
    if (error) throw new Error(`v_products: ${error.code ?? "query_failed"}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const [catalog, products, prepacks, spots] = await Promise.all([
    catalogRows(), posterGet("menu.getProducts"), posterGet("menu.getPrepacks"), posterGet("access.getSpots"),
  ]);
  const productById = new Map(products.map((row) => [String(row.product_id), row]));
  const prepackIds = new Set(prepacks.map((row) => String(row.product_id)));
  const tracked = products.filter((row) => row.ingredient_id && String(row.ingredient_id) !== "0");
  const trackedIds = new Set(tracked.map((row) => String(row.ingredient_id)));
  const storeResults = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, spots.length) }, async () => {
    while (next < spots.length) {
      const spot = spots[next++];
      if (spot.storages?.length !== 1) {
        storeResults.push({ spotId: spot.spot_id, error: "storage_mapping_ambiguous" });
        continue;
      }
      try {
        const leftovers = await posterGet("storage.getStorageLeftovers", {
          storage_id: spot.storages[0].storage_id, zero_leftovers: "true",
        });
        storeResults.push({ spotId: spot.spot_id, found: new Set(leftovers.filter((row) => trackedIds.has(String(row.ingredient_id))).map((row) => String(row.ingredient_id))) });
      } catch {
        storeResults.push({ spotId: spot.spot_id, error: "poster_unavailable" });
      }
    }
  }));
  const validStores = storeResults.filter((row) => !row.error);
  const group = { dish_stock_and_recipe: [], dish_recipe_no_stock_id: [], product_stock_no_recipe: [], product_stock_row_missing: [], catalog_missing_in_poster: [], other: [] };
  for (const catalogItem of catalog) {
    const product = productById.get(String(catalogItem.id));
    if (!product) {
      group.catalog_missing_in_poster.push(catalogItem.id);
      continue;
    }
    const isDish = String(product.type) === "2";
    const hasStockId = product.ingredient_id && String(product.ingredient_id) !== "0";
    const hasAllRows = hasStockId && validStores.every((store) => store.found.has(String(product.ingredient_id)));
    if (isDish && hasStockId && hasAllRows) group.dish_stock_and_recipe.push(catalogItem.id);
    else if (isDish && !hasStockId) group.dish_recipe_no_stock_id.push(catalogItem.id);
    else if (!isDish && hasStockId && hasAllRows) group.product_stock_no_recipe.push(catalogItem.id);
    else if (!isDish && hasStockId && !hasAllRows) group.product_stock_row_missing.push(catalogItem.id);
    else group.other.push(catalogItem.id);
  }
  const totalGrouped = Object.values(group).reduce((sum, ids) => sum + ids.length, 0);
  if (totalGrouped !== catalog.length) throw new Error("Group coverage is incomplete");
  const staleIds = group.catalog_missing_in_poster;
  let staleSource = { status: "not_checked" };
  let staleFeedback = { status: "not_checked" };
  if (staleIds.length) {
    const source = await supabase.schema("categories").from("products")
      .select("*").in("id", staleIds);
    staleSource = source.error
      ? { status: "unavailable", code: source.error.code ?? "query_failed" }
      : { status: "available", columns: Object.keys(source.data?.[0] ?? {}), rows: (source.data ?? []).map((row) => ({
        id: row.id, created_at: row.created_at ?? null, updated_at: row.updated_at ?? null,
        deleted_at: row.deleted_at ?? null, is_deleted: row.is_deleted ?? null,
      })) };
    const history = await supabase.from("feedback").select("product_id,created_at")
      .in("product_id", staleIds).order("created_at", { ascending: false }).limit(10000);
    staleFeedback = history.error
      ? { status: "unavailable", code: history.error.code ?? "query_failed" }
      : { status: "available", capped: (history.data ?? []).length === 10000,
        byProduct: staleIds.map((id) => {
          const rows = (history.data ?? []).filter((row) => String(row.product_id) === String(id));
          return { id, feedbackCount: rows.length, latestFeedbackAt: rows[0]?.created_at ?? null };
        }) };
  }
  console.log(JSON.stringify({
    startedAt, finishedAt: new Date().toISOString(),
    catalogCount: catalog.length, posterProductCount: products.length, posterPrepackCount: prepacks.length,
    posterPhotoCount: products.filter((row) => Boolean(String(row.photo ?? "").trim())).length,
    posterPhotoMissingCount: products.filter((row) => !String(row.photo ?? "").trim()).length,
    spots: spots.length, storesRead: validStores.length,
    storeErrors: storeResults.filter((row) => row.error).map(({ spotId, error }) => ({ spotId, error })),
    groups: Object.fromEntries(Object.entries(group).map(([name, ids]) => [name, { count: ids.length, ids: ids.length <= 25 ? ids : undefined }])),
    catalogPrepackOnly: catalog.filter((row) => prepackIds.has(String(row.id)) && !productById.has(String(row.id))).map((row) => row.id),
    staleSource, staleFeedback,
  }, null, 2));
  if (validStores.length !== spots.length || group.other.length) process.exitCode = 1;
}

main().catch((error) => {
  // Never print a fetch URL or Poster response: either can include credentials.
  process.stderr.write(`${error instanceof Error ? error.message : "audit_failed"}\n`);
  process.exitCode = 1;
});
