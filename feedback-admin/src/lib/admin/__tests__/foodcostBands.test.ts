import { describe, expect, it } from "vitest";
import { foodcostBand } from "../foodcostBands";

describe("approved food-cost bands", () => {
  it.each([
    [0, "green"], [34.9999, "green"], [35, "yellow"],
    [39.09, "yellow"], [45, "yellow"], [45.0001, "red"],
    [60, "red"],
  ] as const)("classifies %s as %s using exact values", (value, expected) => {
    expect(foodcostBand(value)).toBe(expected);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])("keeps missing or invalid values neutral", (value) => {
    expect(foodcostBand(value)).toBe("unknown");
  });
});
