import { describe, expect, it } from "vitest";
import { formatProductUnitUk } from "../productUnits";
import { buildSummary } from "../summary";

describe("Ukrainian unit labels in seller output", () => {
  it("keeps weight and pieces distinct in summaries", () => {
    const weighted = buildSummary({ category: "missing_item", fields: { product_name: "Пельмені", product_unit: "kg", quantity: 0.5 } });
    const pieces = buildSummary({ category: "missing_item", fields: { product_name: "Пакет", product_unit: "p", quantity: 2 } });
    expect(weighted).toContain("Пельмені · 0.5 кг");
    expect(pieces).toContain("Пакет · 2 шт");
  });

  it("does not invent a piece unit when Poster omitted it", () => {
    expect(formatProductUnitUk(null)).toBeNull();
    expect(buildSummary({ category: "missing_item", fields: { product_name: "Товар", quantity: 1 } })).toContain("Товар · 1");
  });
});
