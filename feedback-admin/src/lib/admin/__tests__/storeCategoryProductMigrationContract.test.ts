import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/052_store_category_product_analytics.sql"), "utf8");

describe("migration 052 category/product analytics contract", () => {
  it("stays inside feedbackgb and exposes only the bounded reader", () => {
    expect(sql).not.toMatch(/create\s+(?:table|view|function)\s+public\./i);
    expect(sql).toContain("security definer");
    expect(sql).toContain("grant execute on function feedbackgb.read_store_category_product_analytics");
    expect(sql).toMatch(/revoke all on function feedbackgb\._store_analytics_latest_facts[\s\S]+service_role/i);
  });

  it("uses latest completed snapshots and blocks partial rankings", () => {
    expect(sql).toContain("distinct on (r.business_date, r.spot_id)");
    expect(sql).toContain("r.status = 'completed'");
    expect(sql).toContain("if v_current_complete then");
    expect(sql).toContain("'status', case when v_current_complete then 'complete' else 'incomplete' end");
  });

  it("preserves modifier and unit identity and labels penetration unavailable", () => {
    expect(sql).toContain("group by product_id, modification_id, category_id, unit, weight_based");
    expect(sql).toContain("'modificationId', modification_id");
    expect(sql).toContain("receipt_line_quantity_and_money_basis_unverified");
  });

  it("keeps revenue shares on the unfiltered selected-store denominator", () => {
    expect(sql).toContain("into v_total_revenue");
    expect(sql).toContain("round(revenue * 100.0 / v_total_revenue");
  });
});
