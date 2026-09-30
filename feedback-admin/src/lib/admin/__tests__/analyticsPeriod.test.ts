import { describe, expect, it } from "vitest";
import { analyticsAddDays, analyticsIsoDate, analyticsKyivDate, analyticsWindow, applyAnalyticsPeriodQuery, parseAnalyticsPeriod } from "../analyticsPeriod";
const NOW = new Date("2026-09-29T12:00:00Z");
const parse = (query = "", now = NOW) => parseAnalyticsPeriod(new URLSearchParams(query), now);

describe("unified analytics calendar contract", () => {
  it("defaults to seven closed Kyiv dates", () => expect(parse()).toMatchObject({ preset: "7d", closed: { from: "2026-09-22", to: "2026-09-28" }, provisionalDate: null }));
  it.each([7, 14, 30, 60])("adapts legacy days=%s", days => expect(parse(`days=${days}`).closed?.dates).toHaveLength(days));
  it("supports the 90-day preset", () => expect(parse("period=90d").closed?.dates).toHaveLength(90));
  it("resolves current month", () => expect(parse("period=month").closed).toMatchObject({ from: "2026-09-01", to: "2026-09-28" }));
  it("resolves previous month", () => expect(parse("period=previous-month").closed).toMatchObject({ from: "2026-08-01", to: "2026-08-31" }));
  it("resolves current quarter", () => expect(parse("period=quarter").closed).toMatchObject({ from: "2026-07-01", to: "2026-09-28" }));
  it("resolves year to date", () => expect(parse("period=ytd").closed).toMatchObject({ from: "2026-01-01", to: "2026-09-28" }));
  it("retains prior years for all history", () => expect(parse("period=all", new Date("2027-02-01T12:00:00Z")).closed).toMatchObject({ from: "2026-01-01", to: "2027-01-31" }));
  it("starts YTD at current year", () => expect(parse("period=ytd", new Date("2027-02-01T12:00:00Z")).closed).toMatchObject({ from: "2027-01-01", to: "2027-01-31" }));
  it("keeps custom endpoints inclusive", () => expect(parse("period=custom&from=2026-01-01&to=2026-01-03").closed?.dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]));
  it("allows a single date", () => expect(parse("period=custom&from=2026-01-15&to=2026-01-15").closed?.dates).toHaveLength(1));
  it("splits today explicitly without silently changing requested range", () => {
    const period = parse("period=custom&from=2026-09-22&to=2026-09-29");
    expect(period.requested.to).toBe("2026-09-29"); expect(period.closed?.to).toBe("2026-09-28");
    expect(period.provisionalDate).toBe("2026-09-29"); expect(period.comparison.window?.dates).toHaveLength(7);
  });
  it("today has no completed window", () => expect(parse("period=today")).toMatchObject({ closed: null, provisionalDate: "2026-09-29", comparison: { reason: "no_closed_days" } }));
  it("yesterday is exactly one day", () => expect(parse("period=yesterday").closed?.dates).toEqual(["2026-09-28"]));
  it("does not silently trim previous comparison at history start", () => expect(parse("period=ytd").comparison).toMatchObject({ status: "unavailable", reason: "before_history_start" }));
  it("can disable comparison", () => expect(parse("comparison=off").comparison).toEqual({ status: "disabled", window: null, reason: "disabled" }));
  it("supports an explicit closed comparison range", () => expect(parse("comparison=custom&compare_from=2026-08-01&compare_to=2026-08-31").comparison.window?.dates).toHaveLength(31));
  it("rejects a provisional comparison", () => expect(() => parse("comparison=custom&compare_from=2026-09-28&compare_to=2026-09-29")).toThrow("analytics_comparison_not_closed"));
  it("does not allocate dates for unavailable ancient comparison", () => expect(parse("comparison=custom&compare_from=0001-01-01&compare_to=2026-09-28").comparison).toEqual({ status: "unavailable", window: { from: "0001-01-01", to: "2026-09-28", dates: [] }, reason: "before_history_start" }));
  it("rejects a distant future comparison before allocating its dates", () => expect(() => parse("comparison=custom&compare_from=0001-01-01&compare_to=9999-12-31")).toThrow("analytics_comparison_not_closed"));
  it("rejects reversed comparison endpoints", () => expect(() => parse("comparison=custom&compare_from=2026-09-28&compare_to=2026-09-01")).toThrow("invalid_analytics_date_range"));
  it("keeps unavailable previous endpoints without constructing fetch dates", () => {
    const comparison = parse("period=ytd").comparison;
    expect(comparison.window?.to).toBe("2025-12-31"); expect(comparison.window?.dates).toEqual([]);
  });
  it("rejects reversed custom range", () => expect(() => parse("period=custom&from=2026-09-28&to=2026-09-22")).toThrow("invalid_analytics_date_range"));
  it("rejects future dates", () => expect(() => parse("period=custom&from=2026-09-28&to=2026-09-30")).toThrow("analytics_period_in_future"));
  it("rejects dates before history", () => expect(() => parse("period=custom&from=2025-12-31&to=2026-01-02")).toThrow("analytics_period_before_history"));
  it.each(["2026-02-31", "2026-02-29", "2026-13-01", "2026-9-01", "bad"])("rejects invalid date %s", date => expect(() => analyticsIsoDate(date)).toThrow("invalid_analytics_date"));
  it("accepts an actual leap day", () => expect(analyticsIsoDate("2028-02-29")).toBe("2028-02-29"));
  it.each(["period=7d&days=7", "days=7&from=2026-01-01", "period=month&to=2026-09-28"])("rejects conflicting inputs %s", query => expect(() => parse(query)).toThrow("conflicting_analytics_period"));
  it.each(["days=07", "days=90", "period=unknown", "period=", "period=custom"])("rejects unsupported inputs %s", query => expect(() => parse(query)).toThrow());
  it.each(["period=7d&period=14d", "days=7&days=7", "comparison=off&comparison=previous"])("rejects repeated query %s", query => expect(() => parse(query)).toThrow("duplicate_analytics_query"));
  it("rejects ignored comparison dates", () => expect(() => parse("compare_from=2026-08-01")).toThrow("conflicting_analytics_comparison"));
  it("does not fabricate closed days on month start", () => expect(() => parse("period=month", new Date("2026-10-01T10:00:00Z"))).toThrow("analytics_closed_period_empty"));
  it("does not fabricate closed days on year start", () => expect(() => parse("period=ytd", new Date("2027-01-01T10:00:00Z"))).toThrow("analytics_closed_period_empty"));
  it("uses local Kyiv date across UTC midnight", () => expect(analyticsKyivDate(new Date("2026-09-28T21:30:00Z"))).toBe("2026-09-29"));
  it.each(["2026-03-30T10:00:00Z", "2026-10-26T10:00:00Z"])("keeps seven dates continuous across DST %s", time => {
    const dates = parse("period=7d", new Date(time)).closed!.dates;
    expect(dates).toHaveLength(7); dates.slice(1).forEach((date, index) => expect(date).toBe(analyticsAddDays(dates[index], 1)));
  });
  it("uses proper previous month across year boundary", () => expect(parse("period=previous-month", new Date("2027-01-15T10:00:00Z")).closed).toMatchObject({ from: "2026-12-01", to: "2026-12-31" }));
  it("builds adjacent equal previous windows", () => {
    const period = parse("period=30d"); expect(period.comparison.window?.dates).toHaveLength(30);
    expect(period.comparison.window?.to).toBe(analyticsAddDays(period.closed!.from, -1));
  });
  it("auto buckets by span and accepts explicit grain", () => {
    expect(parse().grain).toBe("day"); expect(parse("period=90d").grain).toBe("week");
    expect(parse("period=ytd").grain).toBe("month"); expect(parse("period=ytd&grain=day").grain).toBe("day");
  });
  it("rejects unsupported grain", () => expect(() => parse("grain=hour")).toThrow("invalid_analytics_grain"));
  it("retains other navigation parameters", () => {
    const updated = applyAnalyticsPeriodQuery(new URLSearchParams("tab=matrix&category_id=2&spot_id=1&method=netto&days=7"), parse("period=custom&from=2026-01-01&to=2026-09-28"));
    expect(updated.get("tab")).toBe("matrix"); expect(updated.get("category_id")).toBe("2");
    expect(updated.get("spot_id")).toBe("1"); expect(updated.get("method")).toBe("netto"); expect(updated.has("days")).toBe(false);
    expect(parseAnalyticsPeriod(updated, NOW).requested).toEqual(parse("period=custom&from=2026-01-01&to=2026-09-28").requested);
  });
  it("does not mutate caller query", () => { const query = new URLSearchParams("days=7"); applyAnalyticsPeriodQuery(query, parse()); expect(query.toString()).toBe("days=7"); });
  it("validates clock and day arithmetic", () => {
    expect(() => parse("", new Date("invalid"))).toThrow("invalid_analytics_clock");
    expect(() => analyticsAddDays("2026-01-01", 1.5)).toThrow("invalid_analytics_date");
    expect(() => analyticsWindow("2026-09-02", "2026-09-01")).toThrow("invalid_analytics_date_range");
  });
});
