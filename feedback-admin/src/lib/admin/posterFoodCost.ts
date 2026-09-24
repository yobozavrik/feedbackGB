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

/** Price/cost are Poster minor currency units; weight_flag=1 is priced per 100 g. */
export function buildFoodCostSample(
  product: PosterFoodCostProduct,
  spots: PosterSpot[],
  settings: PosterSettings,
  checkedAt: string,
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

  const ingredients = (Array.isArray(product.ingredients) ? product.ingredients : [])
    .map((row, index): FoodCostIngredient => ({
      key: String(row.structure_id ?? index),
      name: row.ingredient_name?.trim() || `Компонент #${index + 1}`,
      kind: String(row.structure_type) === "2" ? "prepack" : "ingredient",
      brutto: finiteNumber(row.structure_brutto),
      unit: row.structure_unit?.trim() || null,
      costMinor: nonnegativeMinor(row.structure_selfprice),
    }));
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
  return buildFoodCostSample(product, spots, settings, new Date().toISOString());
}
