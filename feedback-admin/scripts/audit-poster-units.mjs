/** Read-only inventory of units actually present in the catalog and Poster. */
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());
const token = process.env.POSTER_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!token || !supabaseUrl || !serviceKey) {
  process.stderr.write("Required server credentials are not configured.\n");
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
  if (!body || typeof body !== "object" || !("response" in body) || body.error) {
    throw new Error(`${method}: invalid response`);
  }
  return body.response;
}

function counts(values) {
  return Object.fromEntries([...values.reduce((map, value) => {
    const key = value == null || String(value).trim() === "" ? "<empty>" : String(value).trim();
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function parallelMap(rows, worker, concurrency = 4) {
  const results = new Array(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++;
      try { results[index] = { ok: true, value: await worker(rows[index]) }; }
      catch { results[index] = { ok: false, id: rows[index].product_id ?? rows[index].spot_id }; }
    }
  }));
  return results;
}

async function main() {
  const startedAt = new Date().toISOString();
  const catalog = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("v_products").select("id,unit").order("id").range(offset, offset + 999);
    if (error) throw new Error(`v_products: ${error.code ?? "query_failed"}`);
    catalog.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const [products, prepacks, spots, ingredients] = await Promise.all([
    posterGet("menu.getProducts"), posterGet("menu.getPrepacks"), posterGet("access.getSpots"), posterGet("menu.getIngredients"),
  ]);
  if (![products, prepacks, spots, ingredients].every(Array.isArray)) throw new Error("Poster list response invalid");
  const ingredientById = new Map(ingredients.map((row) => [String(row.ingredient_id), row]));
  const productDetails = await parallelMap(products, (row) =>
    posterGet("menu.getProduct", { product_id: row.product_id }));
  const prepackDetails = await parallelMap(prepacks, (row) =>
    posterGet("menu.getPrepack", { product_id: row.product_id }));
  const storageDetails = await parallelMap(spots.filter((row) => row.storages?.length === 1), (row) =>
    posterGet("storage.getStorageLeftovers", { storage_id: row.storages[0].storage_id, zero_leftovers: "true" }));

  const ingredientUnits = (results) => results.flatMap((row) => row.ok && Array.isArray(row.value?.ingredients)
    ? row.value.ingredients.map((ingredient) => ingredient.structure_unit) : []);
  const ingredientExamples = (results, unit) => results.flatMap((row) => row.ok && Array.isArray(row.value?.ingredients)
    ? row.value.ingredients.filter((ingredient) => ingredient.structure_unit === unit)
      .map((ingredient) => ({ name: ingredient.ingredient_name, quantity: ingredient.structure_brutto })) : []).slice(0, 8);
  const stockUnits = storageDetails.flatMap((row) => row.ok && Array.isArray(row.value)
    ? row.value.map((ingredient) => ingredient.ingredient_unit) : []);
  const stockUnitsByIngredient = new Map();
  for (const result of storageDetails) {
    if (!result.ok || !Array.isArray(result.value)) continue;
    for (const item of result.value) {
      const key = String(item.ingredient_id);
      if (!stockUnitsByIngredient.has(key)) stockUnitsByIngredient.set(key, new Set());
      stockUnitsByIngredient.get(key).add(item.ingredient_unit);
    }
  }
  const mismatchedProducts = products.flatMap((product) => {
    const catalogUnit = product.unit?.trim() || null;
    const stock = [...(stockUnitsByIngredient.get(String(product.ingredient_id)) ?? [])];
    return catalogUnit && stock.some((unit) => unit !== catalogUnit)
      ? [{ id: product.product_id, name: product.product_name, ingredientId: product.ingredient_id,
          catalogUnit, stockUnits: stock }] : [];
  });
  const mixedStockUnits = [...stockUnitsByIngredient.entries()]
    .filter(([, units]) => units.size > 1)
    .map(([ingredientId, units]) => ({ ingredientId, units: [...units] }));
  console.log(JSON.stringify({
    startedAt, finishedAt: new Date().toISOString(),
    ingredients: { count: ingredients.length, firstKeys: Object.keys(ingredients[0] ?? {}),
      units: counts(ingredients.map((row) => row.ingredient_unit)) },
    catalog: { count: catalog.length, units: counts(catalog.map((row) => row.unit)) },
    products: { count: products.length, listUnits: counts(products.map((row) => row.unit)),
      mismatchedStockUnitCount: mismatchedProducts.length, mismatchedStockUnitExamples: mismatchedProducts.slice(0, 30),
      possibleWeightMismatches: mismatchedProducts.filter((row) => /(?:\d[,.]\d*\s*кг|\d+\s*г\b|ваг|ковбас|пельмен|вареник)/i.test(row.name)).slice(0, 50),
      noUnit: products.filter((row) => row.unit == null || String(row.unit).trim() === "")
        .map((row) => ({ id: row.product_id, name: row.product_name, type: row.type, ingredientId: row.ingredient_id,
          ingredientUnit: ingredientById.get(String(row.ingredient_id))?.ingredient_unit ?? null })),
      detailsRead: productDetails.filter((row) => row.ok).length,
      failedIds: productDetails.filter((row) => !row.ok).map((row) => row.id),
      recipeUnits: counts(ingredientUnits(productDetails)), pieceExamples: ingredientExamples(productDetails, "p") },
    prepacks: { count: prepacks.length, detailsRead: prepackDetails.filter((row) => row.ok).length,
      failedIds: prepackDetails.filter((row) => !row.ok).map((row) => row.id),
      recipeUnits: counts(ingredientUnits(prepackDetails)), pieceExamples: ingredientExamples(prepackDetails, "p"),
      pieceRows: prepackDetails.flatMap((row) => row.ok && Array.isArray(row.value?.ingredients)
        ? row.value.ingredients.filter((item) => item.structure_unit === "p")
          .map((item) => ({ prepackId: row.value.product_id, prepackName: row.value.product_name,
            output: row.value.out, ingredientName: item.ingredient_name,
            brutto: item.structure_brutto, netto: item.structure_netto })) : []) },
    storages: { count: spots.length, read: storageDetails.filter((row) => row.ok).length,
      failedSpotIds: storageDetails.filter((row) => !row.ok).map((row) => row.id),
      units: counts(stockUnits), mixedUnitIngredientCount: mixedStockUnits.length,
      mixedUnitIngredients: mixedStockUnits.slice(0, 20),
      pieceExamples: storageDetails.flatMap((row) => row.ok && Array.isArray(row.value)
        ? row.value.filter((item) => item.ingredient_unit === "p")
          .map((item) => ({ name: item.ingredient_name, quantity: item.storage_ingredient_left })) : []).slice(0, 8) },
  }, null, 2));
  if (productDetails.some((row) => !row.ok) || prepackDetails.some((row) => !row.ok) || storageDetails.some((row) => !row.ok)) process.exitCode = 1;
}

main().catch((error) => {
  // Poster URLs contain credentials; never print a URL or raw response.
  process.stderr.write(`${error instanceof Error ? error.message : "audit_failed"}\n`);
  process.exitCode = 1;
});
