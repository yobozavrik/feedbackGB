import { describe, expect, it } from "vitest";
import { currentKyivMonth, isSaturdayOrSunday, kyivDateTimeParts, kyivMonthDates, kyivWallTimeToIso, moveSameDayShiftToKyivDate, ukraineHolidayName } from "../scheduleTime";

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

  it("returns every date in September, including the 30th", () => {
    const dates = kyivMonthDates("2026-09");
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-09-01");
    expect(dates.at(-1)).toBe("2026-09-30");
  });

  it("preserves Kyiv wall-clock times when a grid card is moved to another day", () => {
    const moved = moveSameDayShiftToKyivDate(
      kyivWallTimeToIso("2026-09-04", "09:00"),
      kyivWallTimeToIso("2026-09-04", "20:00"),
      "2026-09-16",
    );
    expect(kyivDateTimeParts(moved.starts_at)).toEqual({ date: "2026-09-16", time: "09:00" });
    expect(kyivDateTimeParts(moved.ends_at)).toEqual({ date: "2026-09-16", time: "20:00" });
  });

  it("does not permit an overnight shift to be moved through a one-day grid cell", () => {
    expect(() => moveSameDayShiftToKyivDate(
      kyivWallTimeToIso("2026-09-04", "22:00"),
      kyivWallTimeToIso("2026-09-05", "06:00"),
      "2026-09-16",
    )).toThrow("Нічну зміну");
  });

  it("identifies Ukraine's fixed and Orthodox movable holidays", () => {
    expect(ukraineHolidayName("2026-08-24")).toBe("День Незалежності України");
    expect(ukraineHolidayName("2026-04-12")).toBe("Великдень");
    expect(ukraineHolidayName("2026-05-31")).toBe("Трійця");
  });

  it("marks Saturday and Sunday as calendar highlights without making them unavailable", () => {
    expect(isSaturdayOrSunday("2026-09-19")).toBe(true);
    expect(isSaturdayOrSunday("2026-09-20")).toBe(true);
    expect(isSaturdayOrSunday("2026-09-21")).toBe(false);
  });
});
