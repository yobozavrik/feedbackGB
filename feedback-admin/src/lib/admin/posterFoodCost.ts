import { posterRequest, PosterApiError } from "./posterApi";

type MoneyValue = string | number | null | undefined;

type PosterFoodCostProduct = {
  product_id?: string | number;
  product_name?: string;
  unit?: string | null;
  weight_flag?: string | number;
  out?: string | number | null;
  cost?: MoneyValue;
  spots?: Array<{ spot_id?: string | number; price?: MoneyValue; profit?: MoneyValue; visible?: string | number }>;
  ingredients?: Array<{
    structure_id?: string | number;
    ingredient_id?: string | number;
    ingredient_name?: string;
    structure_type?: string | number;
    structure_brutto?: string | number | null;
    structure_unit?: string | null;
    structure_selfprice?: MoneyValue;
  }>;
};

type PosterSpot = { spot_id?: string | number; spot_name?: string };
type PosterSettings = { currency?: { currency_code_iso?: string; currency_symbol?: string } };

export type FoodCostStore = {
  storeId: number;
  storeName: string;
  visible: boolean;
  priceMinor: number | null;
  profitMinor: number | null;
  foodCostPercent: number | null;
  priceMatchesCostAndProfit: boolean | null;
};

export type FoodCostIngredient = {
  key: string;
  ingredientId: number | null;
  name: string;
  kind: "ingredient" | "prepack";
  brutto: number | null;
  unit: string | null;
  costMinor: number | null;
};

export type FoodCostSample = {
  checkedAt: string;
  productId: number;
  productName: string;
  currencyCode: string;
  currencySymbol: string;
  unit: string | null;
  weightBased: boolean;
  priceBasis: "100g" | "item";
  recipeOutput: number | null;
  costMinor: number | null;
  ingredients: FoodCostIngredient[];
  prepacks: Array<{ productId: number; outputWeight: number | null; posterCostMinor: number | null; ingredients: FoodCostIngredient[] }>;
  ingredientTotalMinor: number | null;
  stores: FoodCostStore[];
};

function nonnegativeMinor(value: MoneyValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function signedMinor(value: MoneyValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function finiteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseIngredients(rows: PosterFoodCostProduct["ingredients"]): FoodCostIngredient[] {
  return (Array.isArray(rows) ? rows : []).map((row, index): FoodCostIngredient => ({
    key: String(row.structure_id ?? index),
    ingredientId: Number.isSafeInteger(Number(row.ingredient_id)) && Number(row.ingredient_id) > 0 ? Number(row.ingredient_id) : null,
    name: row.ingredient_name?.trim() || `Компонент #${index + 1}`,
    kind: String(row.structure_type) === "2" ? "prepack" : "ingredient",
    brutto: finiteNumber(row.structure_brutto),
    unit: row.structure_unit?.trim() || null,
    costMinor: nonnegativeMinor(row.structure_selfprice),
  }));
}

/** Price/cost are Poster minor currency units; weight_flag=1 is priced per 100 g. */
export function buildFoodCostSample(
  product: PosterFoodCostProduct,
  spots: PosterSpot[],
  settings: PosterSettings,
  checkedAt: string,
  prepacks: Array<{ productId: number; outputWeight: number | null; posterCostMinor: number | null; ingredients: FoodCostIngredient[] }> = [],
): FoodCostSample {
  const productId = Number(product.product_id);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new PosterApiError("poster_invalid_response");
  const weightBased = String(product.weight_flag) === "1" && product.unit === "kg";
  if (!weightBased) throw new PosterApiError("food_cost_sample_requires_weight_kg");

  const costMinor = nonnegativeMinor(product.cost);
  const spotNames = new Map(spots.map((spot) => [Number(spot.spot_id), spot.spot_name?.trim() || `Магазин #${spot.spot_id}`]));
  const stores = (Array.isArray(product.spots) ? product.spots : []).map((spot): FoodCostStore => {
    const storeId = Number(spot.spot_id);
    const priceMinor = nonnegativeMinor(spot.price);
    const profitMinor = signedMinor(spot.profit);
    return {
      storeId,
      storeName: spotNames.get(storeId) ?? `Магазин #${storeId}`,
      visible: String(spot.visible) === "1",
      priceMinor,
      profitMinor,
      foodCostPercent: costMinor !== null && costMinor > 0 && priceMinor !== null && priceMinor > 0
        ? (costMinor / priceMinor) * 100 : null,
      priceMatchesCostAndProfit: costMinor !== null && priceMinor !== null && profitMinor !== null
        ? priceMinor - costMinor === profitMinor : null,
    };
  }).filter((spot) => Number.isSafeInteger(spot.storeId) && spot.storeId > 0);

  const ingredients = parseIngredients(product.ingredients);
  const ingredientTotalMinor = ingredients.length > 0 && ingredients.every((row) => row.costMinor !== null)
    ? ingredients.reduce((sum, row) => sum + (row.costMinor ?? 0), 0) : null;

  return {
    checkedAt,
    productId,
    productName: product.product_name?.trim() || `Продукт #${productId}`,
    currencyCode: settings.currency?.currency_code_iso ?? "—",
    currencySymbol: settings.currency?.currency_symbol ?? "",
    unit: product.unit ?? null,
    weightBased,
    priceBasis: "100g",
    recipeOutput: finiteNumber(product.out),
    costMinor,
    ingredients,
    prepacks,
    ingredientTotalMinor,
    stores,
  };
}

export async function getLiveFoodCostSample(productId: number, token: string): Promise<FoodCostSample> {
  const [product, spots, settings] = await Promise.all([
    posterRequest<PosterFoodCostProduct>("menu.getProduct", { product_id: String(productId) }, token),
    posterRequest<PosterSpot[]>("access.getSpots", {}, token),
    posterRequest<PosterSettings>("settings.getAllSettings", {}, token),
  ]);
  if (!product || Number(product.product_id) !== productId || !Array.isArray(spots) || !settings) {
    throw new PosterApiError("poster_invalid_response");
  }
  const prepackIds = [...new Set((product.ingredients ?? [])
    .filter((row) => String(row.structure_type) === "2")
    .map((row) => Number(row.ingredient_id)))].filter((id) => Number.isSafeInteger(id) && id > 0);
  const prepackResults = await Promise.allSettled(prepackIds.slice(0, 5).map(async (id) => {
    const detail = await posterRequest<PosterFoodCostProduct>("menu.getPrepack", { product_id: String(id) }, token);
    if (!detail || Number(detail.product_id) !== id) throw new PosterApiError("poster_invalid_prepack");
    return { productId: id, outputWeight: finiteNumber(detail.out),
      posterCostMinor: nonnegativeMinor(detail.cost), ingredients: parseIngredients(detail.ingredients) };
  }));
  // A failed prepack lookup must not hide the live Poster product/price.
  // The independent supply comparison will show that row as unavailable.
  const prepackDetails = prepackResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  return buildFoodCostSample(product, spots, settings, new Date().toISOString(), prepackDetails);
}
