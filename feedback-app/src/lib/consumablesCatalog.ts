// Pure helpers for the consumables catalog pagination, split out of the
// component so they can be unit-tested (the current vitest setup is node-env,
// .test.ts only — it doesn't render React).

export interface CatalogItem {
  id: number;
  name: string;
  unit: string | null;
  category_name: string | null;
  photo_url: string | null;
}

export interface CatalogResponse {
  items?: CatalogItem[];
  page?: number;
  total_pages?: number;
}

export const CATALOG_PAGE_SIZE = 40;

/** Build the query string for one catalog page. Search is trimmed and omitted when blank. */
export function buildCatalogQuery(page: number, search: string): string {
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    page_size: String(CATALOG_PAGE_SIZE),
  });
  const s = search.trim();
  if (s) params.set("search", s);
  return params.toString();
}

/**
 * Accumulate a freshly-fetched page into the current list.
 *   reset=true  → replace (new search / first load)
 *   reset=false → append, de-duplicated by id (guards against overlap or a
 *                 double-fired "load more")
 */
export function mergeCatalogPage(
  prev: CatalogItem[],
  incoming: CatalogItem[],
  reset: boolean,
): CatalogItem[] {
  if (reset) return incoming;
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...incoming.filter((i) => !seen.has(i.id))];
}
