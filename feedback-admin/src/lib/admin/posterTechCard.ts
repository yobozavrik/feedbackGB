const POSTER_API = "https://joinposter.com/api/";
const MAX_PREPACK_DEPTH = 5;
const MAX_PREPACK_REQUESTS = 25;

type PosterIngredient = {
  structure_id?: string | number;
  ingredient_id?: string | number;
  ingredient_name?: string;
  structure_type?: string | number;
  structure_brutto?: string | number | null;
  structure_netto?: string | number | null;
  structure_unit?: string | null;
};

type PosterRecipe = {
  product_id?: string | number;
  product_name?: string;
  out?: string | number | null;
  product_production_description?: string | null;
  ingredients?: PosterIngredient[];
};

export type TechIngredient = {
  key: string;
  name: string;
  kind: "ingredient" | "prepack";
  brutto: number | null;
  netto: number | null;
  unit: string | null;
  prepack: TechRecipe | null;
  prepackStatus: "ok" | "unavailable" | "depth_limit" | "cycle" | null;
};

export type TechRecipe = {
  productId: number;
  name: string;
  output: number | null;
  productionDescription: string | null;
  ingredients: TechIngredient[];
};

export type ProductTechCard = { recipe: TechRecipe; checkedAt: string };

export class PosterTechCardError extends Error {
  constructor(public code: string) { super(code); }
}

async function posterGet(method: string, productId: number, token: string): Promise<PosterRecipe> {
  const url = new URL(method, POSTER_API);
  url.searchParams.set("token", token);
  url.searchParams.set("product_id", String(productId));
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch {
    // The request URL contains the token; never return or log it.
    throw new PosterTechCardError("poster_unavailable");
  }
  if (!response.ok) throw new PosterTechCardError("poster_unavailable");
  let body: { response?: unknown; error?: unknown };
  try { body = await response.json(); } catch { throw new PosterTechCardError("poster_invalid_response"); }
  if (body.error) throw new PosterTechCardError("poster_invalid_response");
  if (!body.response || typeof body.response !== "object" || Array.isArray(body.response)) {
    throw new PosterTechCardError("recipe_not_found");
  }
  const recipe = body.response as PosterRecipe;
  if (Number(recipe.product_id) !== productId) throw new PosterTechCardError("recipe_not_found");
  return recipe;
}

function finiteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getLiveProductTechCard(productId: number, token: string): Promise<ProductTechCard> {
  let root: PosterRecipe;
  try {
    root = await posterGet("menu.getProduct", productId, token);
  } catch (error) {
    if (!(error instanceof PosterTechCardError) || error.code !== "recipe_not_found") throw error;
    root = await posterGet("menu.getPrepack", productId, token);
  }

  let prepackRequests = 0;
  const build = async (source: PosterRecipe, ancestors: Set<number>, depth: number): Promise<TechRecipe> => {
    const rows = Array.isArray(source.ingredients) ? source.ingredients : [];
    const ingredients: TechIngredient[] = [];
    for (const [index, item] of rows.entries()) {
      const prepackId = Number(item.ingredient_id);
      const isPrepack = String(item.structure_type) === "2";
      const row: TechIngredient = {
        key: `${index}-${item.structure_id ?? item.ingredient_id ?? "unknown"}`,
        name: item.ingredient_name?.trim() || `Інгредієнт #${item.ingredient_id ?? "?"}`,
        kind: isPrepack ? "prepack" : "ingredient",
        brutto: finiteNumber(item.structure_brutto),
        netto: finiteNumber(item.structure_netto),
        unit: item.structure_unit?.trim() || null,
        prepack: null,
        prepackStatus: isPrepack ? "unavailable" : null,
      };
      if (isPrepack) {
        if (!Number.isSafeInteger(prepackId) || prepackId <= 0) row.prepackStatus = "unavailable";
        else if (ancestors.has(prepackId)) row.prepackStatus = "cycle";
        else if (depth >= MAX_PREPACK_DEPTH || prepackRequests >= MAX_PREPACK_REQUESTS) row.prepackStatus = "depth_limit";
        else {
          prepackRequests++;
          try {
            const sourcePrepack = await posterGet("menu.getPrepack", prepackId, token);
            row.prepack = await build(sourcePrepack, new Set([...ancestors, prepackId]), depth + 1);
            row.prepackStatus = "ok";
          } catch { row.prepackStatus = "unavailable"; }
        }
      }
      ingredients.push(row);
    }
    return {
      productId: Number(source.product_id),
      name: source.product_name?.trim() || `Продукт #${source.product_id}`,
      output: finiteNumber(source.out),
      productionDescription: source.product_production_description?.trim() || null,
      ingredients,
    };
  };

  return { recipe: await build(root, new Set([productId]), 0), checkedAt: new Date().toISOString() };
}
