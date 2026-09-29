import { describe, expect, it } from "vitest";
import { foodcostPeriodWindows, lastClosedKyivDates, parseFoodcostPeriodDays } from "../foodcostPeriod";

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

  it("builds adjacent, non-overlapping equal windows for every preset", () => {
    for (const days of [7, 14, 30, 60] as const) {
      const { current, previous } = foodcostPeriodWindows(days, new Date("2026-09-25T00:30:00Z"));
      expect(current.dates).toHaveLength(days);
      expect(previous.dates).toHaveLength(days);
      expect(current.from).toBe(new Date(Date.parse("2026-09-24T00:00:00Z") - (days - 1) * 86_400_000)
        .toISOString().slice(0, 10));
      expect(current.to).toBe("2026-09-24");
      expect(previous.to).toBe(new Date(Date.parse(`${current.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
      expect(new Set([...current.dates, ...previous.dates]).size).toBe(days * 2);
    }
  });

  it("keeps local calendar dates continuous across Kyiv daylight-saving changes", () => {
    const spring = foodcostPeriodWindows(7, new Date("2026-04-03T12:00:00Z"));
    expect(spring.current).toMatchObject({ from: "2026-03-27", to: "2026-04-02" });
    expect(spring.previous).toMatchObject({ from: "2026-03-20", to: "2026-03-26" });
    const autumn = foodcostPeriodWindows(7, new Date("2026-10-30T12:00:00Z"));
    expect(autumn.current).toMatchObject({ from: "2026-10-23", to: "2026-10-29" });
    expect(autumn.previous).toMatchObject({ from: "2026-10-16", to: "2026-10-22" });
  });
});
