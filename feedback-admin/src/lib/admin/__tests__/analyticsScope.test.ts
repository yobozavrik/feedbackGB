import { describe, expect, it } from "vitest";
import { applyAnalyticsScopeQuery, parseAnalyticsScope, resolveAnalyticsSpotIds } from "../analyticsScope";
const parse = (query = "") => parseAnalyticsScope(new URLSearchParams(query));
describe("current selected analytics store scope", () => {
  it("defaults to all current stores without claiming historical roster", () => expect(parse()).toEqual({ spotIds: null, historicalRosterVerified: false }));
  it("supports explicit all", () => expect(parse("spot_ids=all").spotIds).toBeNull());
  it("adapts one legacy store", () => expect(parse("spot_id=2").spotIds).toEqual([2]));
  it("adapts legacy all", () => expect(parse("spot_id=all").spotIds).toBeNull());
  it("supports and sorts multiple stores", () => expect(parse("spot_ids=3,1,2").spotIds).toEqual([1, 2, 3]));
  it.each(["spot_ids=", "spot_ids=0", "spot_ids=-1", "spot_ids=01", "spot_ids=1,1", "spot_ids=all,1", "spot_ids=1,", "spot_ids=1,%202", "spot_ids=9007199254740993", "spot_id=1,2"])("rejects invalid scope %s", query => expect(() => parse(query)).toThrow("invalid_analytics_scope"));
  it("rejects duplicate parameters", () => expect(() => parse("spot_ids=1&spot_ids=2")).toThrow("duplicate_analytics_scope"));
  it("rejects conflicting legacy/new scope", () => expect(() => parse("spot_id=1&spot_ids=1")).toThrow("conflicting_analytics_scope"));
  it("rejects more than100 stores", () => expect(() => parse(`spot_ids=${Array.from({ length: 101 }, (_, index) => index + 1).join(",")}`)).toThrow("invalid_analytics_scope"));
  it("resolves all from verified roster only", () => expect(resolveAnalyticsSpotIds(parse(), [3, 1, 2])).toEqual([1, 2, 3]));
  it("rejects a store outside verified roster", () => expect(() => resolveAnalyticsSpotIds(parse("spot_ids=4"), [1, 2, 3])).toThrow("unknown_analytics_spot"));
  it.each([[], [1, 1], [0], [NaN]].map(ids => ({ ids })))("rejects invalid programmatic selection $ids", ({ ids }) => {
    const scope = { spotIds: ids, historicalRosterVerified: false as const };
    expect(() => resolveAnalyticsSpotIds(scope, [1, 2, 3])).toThrow("invalid_analytics_scope");
    expect(() => applyAnalyticsScopeQuery(new URLSearchParams(), scope)).toThrow("invalid_analytics_scope");
  });
  it.each([[], [1, 1], [0], [NaN]].map(ids => ({ ids })))("rejects invalid roster $ids", ({ ids }) => expect(() => resolveAnalyticsSpotIds(parse(), ids)).toThrow("invalid_analytics_roster"));
  it("preserves period and category while removing legacy scope", () => {
    const query = new URLSearchParams("period=custom&from=2026-01-01&to=2026-09-28&category_id=2&spot_id=1");
    const updated = applyAnalyticsScopeQuery(query, parse("spot_ids=3,2"));
    expect(updated.has("spot_id")).toBe(false); expect(updated.get("spot_ids")).toBe("2,3");
    expect(updated.get("period")).toBe("custom"); expect(updated.get("from")).toBe("2026-01-01");
    expect(updated.get("category_id")).toBe("2"); expect(query.get("spot_id")).toBe("1");
  });
});
