/** Read-only discovery for the 30-day supply-cost pilot. Never prints credentials or supplier details. */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const token = process.env.POSTER_TOKEN;
if (!token) throw new Error("POSTER_TOKEN is not configured");

function kyivDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function compact(date) { return date.replaceAll("-", ""); }
const to = kyivDate(new Date());
const fromDate = new Date(`${to}T00:00:00Z`);
fromDate.setUTCDate(fromDate.getUTCDate() - 29);
const from = fromDate.toISOString().slice(0, 10);

async function get(method, params = {}) {
  const url = new URL(`https://joinposter.com/api/${method}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (!body || body.error || !Object.hasOwn(body, "response")) throw new Error(`${method}: invalid response`);
  return body.response;
}

const [product, supplies] = await Promise.all([
  get("menu.getProduct", { product_id: 121 }),
  get("storage.getSupplies", { dateFrom: compact(from), dateTo: compact(to) }),
]);
if (!Array.isArray(product?.ingredients) || !Array.isArray(supplies)) throw new Error("Unexpected response shape");
const active = supplies.filter((row) => String(row.delete) !== "1");
const storageCounts = Object.entries(active.reduce((acc, row) => {
  const id = String(row.storage_id ?? "missing");
  acc[id] = (acc[id] ?? 0) + 1;
  return acc;
}, {})).sort((a, b) => Number(a[0]) - Number(b[0]));
const first = active[0];
const sample = first ? await get("storage.getSupplyIngredients", { supply_id: first.supply_id }) : [];
if (!Array.isArray(sample)) throw new Error("Unexpected supply ingredients shape");
const sampleLimit = process.argv.includes("--profile") ? 24 : 1;
const sampled = sampleLimit === 1 ? [sample] : await Promise.all(
  Array.from({ length: Math.min(sampleLimit, active.length) }, (_, index) =>
    active[Math.floor(index * active.length / Math.min(sampleLimit, active.length))])
    .map((header) => get("storage.getSupplyIngredients", { supply_id: header.supply_id })),
);
const sampledLines = sampled.flat();
const invalidSampleLines = sampledLines.filter((row) => !Number.isSafeInteger(Number(row.ingredient_id)) ||
  Number(row.ingredient_id) <= 0 || !Number.isFinite(Number(row.supply_ingredient_num)) ||
  Number(row.supply_ingredient_num) <= 0 || !Number.isSafeInteger(Number(row.supply_ingredient_sum)) ||
  Number(row.supply_ingredient_sum) < 0 || !["kg", "l", "p"].includes(row.ingredient_unit)).length;

process.stdout.write(JSON.stringify({
  checkedAt: new Date().toISOString(), from, to,
  productId: product.product_id,
  recipeRows: product.ingredients.map((row) => ({
    ingredientId: row.ingredient_id,
    structureType: row.structure_type,
    structureBrutto: row.structure_brutto,
    structureUnit: row.structure_unit,
  })),
  suppliesTotal: supplies.length,
  suppliesActive: active.length,
  suppliesDeleted: supplies.length - active.length,
  activeByStorage: storageCounts,
  headerDatesMatchingParser: active.filter((row) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.date ?? "")).length,
  profiledDocumentCount: sampled.length,
  profiledLineCount: sampledLines.length,
  invalidProfiledLineCount: invalidSampleLines,
  profiledUnits: [...new Set(sampledLines.map((row) => row.ingredient_unit))].sort(),
  sampleSupplyId: first?.supply_id ?? null,
  sampleIngredients: sample.map((row) => ({
    ingredientId: row.ingredient_id,
    quantity: row.supply_ingredient_num,
    unit: row.ingredient_unit,
    sumMinor: row.supply_ingredient_sum,
  })),
}, null, 2) + "\n");
