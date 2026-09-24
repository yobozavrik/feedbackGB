/** Read-only, narrow Poster probe for one named product. Never prints the token or raw URLs. */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const token = process.env.POSTER_TOKEN;
if (!token) {
  process.stderr.write("POSTER_TOKEN is not configured.\n");
  process.exit(2);
}

const target = process.argv[2] ?? "Пельмені зі свинини";

async function posterGet(method, params = {}) {
  const url = new URL(`https://joinposter.com/api/${method}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (!body || typeof body !== "object" || body.error || !("response" in body)) {
    throw new Error(`${method}: invalid response`);
  }
  return body.response;
}

function picked(row, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(row ?? {}, key)).map((key) => [key, row[key]]));
}

const products = await posterGet("menu.getProducts");
if (!Array.isArray(products)) throw new Error("menu.getProducts: expected array");
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("uk");
const matches = products.filter((row) => normalized(row.product_name) === normalized(target));
if (!matches.length) throw new Error(`No product matched: ${target}`);

const [spots, settings, ingredientCatalog] = await Promise.all([
  posterGet("access.getSpots"),
  posterGet("settings.getAllSettings"),
  posterGet("menu.getIngredients"),
]);
if (!Array.isArray(spots)) throw new Error("access.getSpots: expected array");
const catalogById = new Map(Array.isArray(ingredientCatalog)
  ? ingredientCatalog.map((row) => [String(row.ingredient_id), row]) : []);

const results = [];
for (const summary of matches) {
  const id = Number(summary.product_id);
  const detail = await posterGet("menu.getProduct", { product_id: id });
  const ingredients = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
  const prepackIds = [...new Set(ingredients.filter((row) => String(row.structure_type) === "2")
    .map((row) => Number(row.ingredient_id)).filter((value) => Number.isSafeInteger(value) && value > 0))];
  const prepacks = [];
  for (const prepackId of prepackIds) {
    const prepack = await posterGet("menu.getPrepack", { product_id: prepackId });
    prepacks.push({
      ...picked(prepack, ["product_id", "product_name", "type", "unit", "out", "cost", "cost_netto", "prime_cost"]),
      ingredients: Array.isArray(prepack?.ingredients) ? prepack.ingredients.map((row) =>
        picked(row, ["ingredient_id", "ingredient_name", "structure_type", "structure_brutto", "structure_unit", "structure_selfprice"])) : [],
    });
  }
  results.push({
    product: picked(detail, ["product_id", "product_name", "type", "unit", "weight_flag", "out", "ingredient_id", "price", "cost", "cost_netto", "different_spots_prices", "spots", "tax_id"]),
    summary: picked(summary, ["product_id", "product_name", "type", "unit", "price", "cost", "cost_netto", "ingredient_id"]),
    productKeys: Object.keys(detail ?? {}).filter((key) => /price|cost|unit|out|type/i.test(key)).sort(),
    ingredients: ingredients.map((row) => ({
      recipe: picked(row, ["structure_id", "ingredient_id", "ingredient_name", "structure_type", "structure_brutto", "structure_netto", "structure_unit", "structure_selfprice", "structure_selfprice_netto"]),
      catalog: String(row.structure_type) === "2" ? null :
        picked(catalogById.get(String(row.ingredient_id)), ["ingredient_id", "ingredient_name", "ingredient_unit", "prime_cost", "prime_cost_netto"]),
      catalogCostKeys: String(row.structure_type) === "2" ? [] :
        Object.keys(catalogById.get(String(row.ingredient_id)) ?? {}).filter((key) => /price|cost|unit/i.test(key)).sort(),
    })),
    prepacks,
  });
}

process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), target, matched: matches.length,
  currency: picked(settings?.currency, ["currency_name", "currency_code", "currency_symbol", "currency_code_iso"]),
  spots: spots.map((row) => picked(row, ["spot_id", "spot_name"])), results }, null, 2)}\n`);
