import { describe, expect, it } from "vitest";
import { parseStoreAnalyticsQuery, STORE_ANALYTICS_VIEWS } from "../storeAnalyticsQuery";
const NOW = new Date("2026-09-29T12:00:00Z");
const parse = (q = "") => parseStoreAnalyticsQuery(new URLSearchParams(q), NOW);
describe("store analytics query contract", () => {
  it("defaults to30 closed days, all current stores and overview", () => expect(parse()).toMatchObject({ period: { preset: "30d", closed: { from: "2026-08-30", to: "2026-09-28" }, resolvedAt: NOW.toISOString() }, scope: { spotIds: null, historicalRosterVerified: false }, view: "overview", page: 1, pageSize: 25 }));
  it.each(STORE_ANALYTICS_VIEWS)("accepts view %s", view => expect(parse(`view=${view}`).view).toBe(view));
  it("preserves explicit legacy period", () => expect(parse("days=7").period.closed?.dates).toHaveLength(7));
  it("supports calendar and multiple stores", () => expect(parse("tab=analytics&period=custom&from=2026-01-01&to=2026-09-28&spot_ids=3,1")).toMatchObject({ period: { requested: { from: "2026-01-01", to: "2026-09-28" } }, scope: { spotIds: [1, 3] } }));
  it("rejects a custom comparison with a different number of days before calling SQL", () => {
    expect(() => parse("period=30d&comparison=custom&compare_from=2026-09-17&compare_to=2026-09-23"))
      .toThrow("store_analytics_comparison_length_mismatch");
  });
  it("handles unknown category explicitly", () => expect(parse("category_id=unknown").categoryId).toBe("unknown"));
  it("keeps filters out of denominator store scope", () => expect(parse("spot_ids=1,2&category_id=3&product_id=4&modification_id=0")).toMatchObject({ scope: { spotIds: [1, 2] }, categoryId: 3, productId: 4, modificationId: 0 }));
  it.each(["view=bad", "tab=reports", "category_id=0", "product_id=01", "product_id=1.5", "page=0", "page=10001", "page_size=200", "sort=sql", "direction=up"])("rejects malformed input %s", query => expect(() => parse(query)).toThrow());
  it.each(["modification_id=-1", "modification_id=1", "product_id=2&modification_id=1.5"])("rejects malformed modification identity %s", query => expect(() => parse(query)).toThrow());
  it.each(["view=stores&view=products", "product_id=1&product_id=1", "spot_ids=1&spot_ids=2"])("rejects duplicate inputs %s", query => expect(() => parse(query)).toThrow("duplicate_store_analytics_query"));
  it.each(["as_of=2026-01-01", "token=secret", "limit=999", "user_id=1"])("rejects unsupported caller authority %s", query => expect(() => parse(query)).toThrow("unknown_store_analytics_query"));
  it.each(["period=today", "period=custom&from=2026-09-28&to=2026-09-29"])("does not promise live support %s", query => expect(() => parse(query)).toThrow("store_analytics_provisional_not_supported"));
  it("bounds search without silently truncating", () => expect(() => parse(`search=${"a".repeat(81)}`)).toThrow("invalid_store_analytics_search"));
  it("rejects control characters", () => expect(() => parse("search=foo%00bar")).toThrow("invalid_store_analytics_search"));
  it("allows Ukrainian names and trims surrounding spaces", () => expect(parse("search=%20Пельмені%20").search).toBe("Пельмені"));
  it("does not mutate original params", () => { const p = new URLSearchParams("view=stores"); parseStoreAnalyticsQuery(p, NOW); expect(p.toString()).toBe("view=stores"); });
});
