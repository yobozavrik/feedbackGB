import { describe, expect, it } from "vitest";
import { normalizeProductSearch, parseProductPage, posterPhotoUrl, productCategoryHref, productHref, productSearchPattern } from "../admin/productCatalog";

describe("product catalog helpers", () => {
  it("normalizes page numbers", () => {
    expect(parseProductPage("2")).toBe(2);
    expect(parseProductPage("0")).toBe(1);
    expect(parseProductPage("1.5")).toBe(1);
    expect(parseProductPage("bad")).toBe(1);
    expect(parseProductPage(["2", "3"])).toBe(2);
  });
  it("limits search and escapes LIKE wildcards", () => {
    expect(normalizeProductSearch("  Пельмені  ")).toBe("Пельмені");
    expect(normalizeProductSearch("x".repeat(100))).toHaveLength(80);
    expect(normalizeProductSearch(["Ковбаса", "Пельмені"])).toBe("Ковбаса");
    expect(productSearchPattern("50%_\\")).toBe("%50\\%\\_\\\\%");
  });
  it("uses only HTTPS product photos or a safe relative POS path", () => {
    expect(posterPhotoUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    expect(posterPhotoUrl("/uploads/a.jpg")).toBe("https://joinposter.com/uploads/a.jpg");
    expect(posterPhotoUrl("javascript:alert(1)")).toBeNull();
    expect(posterPhotoUrl("//evil.example/a.jpg")).toBeNull();
  });
  it("builds category and product links", () => {
    expect(productCategoryHref("9")).toBe("/admin/technologist/products/category/9");
    expect(productHref(30001)).toBe("/admin/technologist/products/item/30001");
  });
});
