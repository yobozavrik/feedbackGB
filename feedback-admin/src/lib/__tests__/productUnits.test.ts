import { describe, expect, it } from "vitest";
import { formatProductUnitUk } from "../productUnits";

describe("Poster measurement labels", () => {
  it.each([
    ["kg", "кг"], ["g", "г"], ["l", "л"], ["ml", "мл"], ["p", "шт"],
    ["pcs", "шт"], ["кг", "кг"], ["шт", "шт"], [" KG ", "кг"],
  ])("renders %s as %s without converting the amount", (source, expected) => {
    expect(formatProductUnitUk(source)).toBe(expected);
  });

  it("does not guess missing or unexpected units", () => {
    expect(formatProductUnitUk(null)).toBeNull();
    expect(formatProductUnitUk(" ")).toBeNull();
    expect(formatProductUnitUk("box")).toBe("Невідома одиниця");
  });
});
