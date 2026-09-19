import { describe, expect, it } from "vitest";
import { currentKyivMonth, kyivDateTimeParts, kyivWallTimeToIso } from "../scheduleTime";

describe("Kyiv schedule time conversion", () => {
  it("preserves a regular Kyiv wall-clock shift", () => {
    const iso = kyivWallTimeToIso("2026-09-19", "09:30");
    expect(kyivDateTimeParts(iso)).toEqual({ date: "2026-09-19", time: "09:30" });
  });

  it("rejects the missing Kyiv DST wall-clock hour", () => {
    expect(() => kyivWallTimeToIso("2026-03-29", "03:30")).toThrow("не існує");
  });

  it("returns a YYYY-MM current Kyiv month", () => {
    expect(currentKyivMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});
