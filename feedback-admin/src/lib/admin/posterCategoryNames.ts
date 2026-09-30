import { posterRequest } from "./posterApi";

export function parseCurrentPosterCategoryNames(value: unknown): Map<number, string> {
  if (!Array.isArray(value) || !value.length || value.length > 1000) {
    throw new Error("poster_categories_invalid_response");
  }
  const names = new Map<number, string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("poster_categories_invalid_response");
    const row = entry as { category_id?: unknown; category_name?: unknown };
    const id = Number(row.category_id);
    const name = typeof row.category_name === "string" ? row.category_name.trim() : "";
    if (!Number.isSafeInteger(id) || id <= 0 || !name ||
      (names.has(id) && names.get(id) !== name)) throw new Error("poster_categories_invalid_response");
    names.set(id, name);
  }
  return names;
}

export async function loadCurrentPosterCategoryNames(signal?: AbortSignal): Promise<Map<number, string>> {
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const value = signal
    ? await posterRequest<unknown>("menu.getCategories", {}, token, signal)
    : await posterRequest<unknown>("menu.getCategories", {}, token);
  return parseCurrentPosterCategoryNames(value);
}
