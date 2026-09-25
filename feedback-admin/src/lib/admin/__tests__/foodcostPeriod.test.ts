import { describe, expect, it } from "vitest";
import { lastClosedKyivDates, parseFoodcostPeriodDays } from "../foodcostPeriod";

describe("foodcost period", () => {
  it("defaults to seven closed days and accepts the four presets", () => {
    expect(parseFoodcostPeriodDays(null)).toBe(7);
    for (const days of [7, 14, 30, 60]) expect(parseFoodcostPeriodDays(String(days))).toBe(days);
  });
  it("rejects arbitrary or malformed windows", () => {
    for (const input of ["3", "0", "61", "07", "7.0", "NaN", "7&spot_id=1"]) {
      expect(() => parseFoodcostPeriodDays(input)).toThrow("invalid_foodcost_period");
    }
  });
  it("uses completed Kyiv calendar dates across local midnight", () => {
    expect(lastClosedKyivDates(7, new Date("2026-09-25T00:30:00Z"))[0]).toBe("2026-09-24");
    expect(lastClosedKyivDates(7, new Date("2026-09-24T21:30:00Z"))[0]).toBe("2026-09-24");
    expect(lastClosedKyivDates(60, new Date("2026-09-25T00:30:00Z"))).toHaveLength(60);
  });
});
