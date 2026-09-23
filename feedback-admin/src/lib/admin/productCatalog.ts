export const PRODUCT_PAGE_SIZE = 24;
export const UNCATEGORIZED_ID = "__unknown";

export interface CatalogProduct {
  id: number;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string | null;
  barcode: string | null;
  photo: string | null;
  cost: number | null;
}

export function parseProductPage(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function normalizeProductSearch(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] ?? "" : value ?? "").trim().slice(0, 80);
}

export function productSearchPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function posterPhotoUrl(photo: string | null): string | null {
  if (!photo) return null;
  const value = photo.trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const base = (process.env.NEXT_PUBLIC_POSTER_CDN_BASE_URL ?? "https://joinposter.com").replace(/\/$/, "");
  try {
    const url = new URL(base);
    return url.protocol === "https:" ? `${url.origin}${value}` : null;
  } catch {
    return null;
  }
}

export function productCategoryHref(categoryId: string): string {
  return `/admin/technologist/products/category/${encodeURIComponent(categoryId)}`;
}

export function productHref(productId: number): string {
  return `/admin/technologist/products/item/${productId}`;
}
