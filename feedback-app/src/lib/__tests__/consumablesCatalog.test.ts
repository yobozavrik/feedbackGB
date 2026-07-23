import { describe, expect, it } from "vitest";
import {
  buildCatalogQuery,
  mergeCatalogPage,
  CATALOG_PAGE_SIZE,
  type CatalogItem,
} from "../consumablesCatalog";

function item(id: number, name = `Item ${id}`): CatalogItem {
  return { id, name, unit: "шт", category_name: null, photo_url: null };
}

describe("buildCatalogQuery", () => {
  it("includes page and page_size", () => {
    const q = new URLSearchParams(buildCatalogQuery(2, ""));
    expect(q.get("page")).toBe("2");
    expect(q.get("page_size")).toBe(String(CATALOG_PAGE_SIZE));
  });

  it("omits search when blank or whitespace-only", () => {
    expect(new URLSearchParams(buildCatalogQuery(1, "")).has("search")).toBe(false);
    expect(new URLSearchParams(buildCatalogQuery(1, "   ")).has("search")).toBe(false);
  });

  it("trims the search term", () => {
    expect(new URLSearchParams(buildCatalogQuery(1, "  мило  ")).get("search")).toBe("мило");
  });

  it("clamps a non-positive page to 1", () => {
    expect(new URLSearchParams(buildCatalogQuery(0, "")).get("page")).toBe("1");
    expect(new URLSearchParams(buildCatalogQuery(-3, "")).get("page")).toBe("1");
  });
});

describe("mergeCatalogPage", () => {
  it("replaces the list when reset is true (new search)", () => {
    const result = mergeCatalogPage([item(1), item(2)], [item(9)], true);
    expect(result.map((i) => i.id)).toEqual([9]);
  });

  it("appends the next page preserving order", () => {
    const result = mergeCatalogPage([item(1), item(2)], [item(3), item(4)], false);
    expect(result.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it("de-duplicates by id so a double-fired load-more can't duplicate rows", () => {
    const prev = [item(1), item(2)];
    const result = mergeCatalogPage(prev, [item(2), item(3)], false);
    expect(result.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("is idempotent when the same page is appended twice", () => {
    const prev = [item(1), item(2)];
    const once = mergeCatalogPage(prev, [item(3)], false);
    const twice = mergeCatalogPage(once, [item(3)], false);
    expect(twice.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("handles an empty incoming page", () => {
    expect(mergeCatalogPage([item(1)], [], false).map((i) => i.id)).toEqual([1]);
    expect(mergeCatalogPage([item(1)], [], true)).toEqual([]);
  });
});
