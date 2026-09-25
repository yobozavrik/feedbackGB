import { describe, expect, it } from "vitest";
import { foodcostStoreCountLabel } from "../foodcostLabels";

describe("foodcost store count labels", () => {
  it.each([
    [1, "1 магазин"], [2, "2 магазини"], [4, "4 магазини"],
    [5, "5 магазинів"], [11, "11 магазинів"], [21, "21 магазин"],
    [26, "26 магазинів"],
  ])("formats %i stores", (count, label) => {
    expect(foodcostStoreCountLabel(count)).toBe(label);
  });
});
