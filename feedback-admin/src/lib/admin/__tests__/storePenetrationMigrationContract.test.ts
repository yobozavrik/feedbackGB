import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/055_store_penetration_analytics.sql"), "utf8").toLowerCase();

describe("055 store penetration reader", () => {
  it("is service-role only and never reads raw/customer payloads", () => {
    expect(sql).toMatch(/revoke all on function feedbackgb\.read_store_penetration_analytics[\s\S]+public,anon,authenticated,service_role/);
    expect(sql).toMatch(/grant execute on function feedbackgb\.read_store_penetration_analytics[\s\S]+service_role/);
    expect(sql).not.toContain("poster_receipt_source_payloads");
    expect(sql).not.toContain("poster_client_snapshots");
  });

  it("uses distinct receipt denominators and never averages store rates", () => {
    expect(sql).toContain("count(distinct receipt_version_id)");
    expect(sql).toContain("distinct eligible purchase receipts in selected network scope");
    expect(sql).not.toContain("avg(penetration");
  });

  it("fails closed for missing coverage or product-category mapping", () => {
    expect(sql).toContain("'mapping_incomplete'");
    expect(sql).toContain("'incomplete'");
    expect(sql).toContain("when (select count(*) from mapped where category_id is null)=0");
  });

  it("keeps historical store roster caveat explicit", () => {
    expect(sql).toContain("'historicalrosterverified',false");
    expect(sql).toContain("v_spots<@r.source_spot_ids");
  });

  it("bounds date and scope inputs", () => {
    expect(sql).toContain("p_to-p_from>365");
    expect(sql).toContain("cardinality(v_spots)>100");
    expect(sql).toContain("store_penetration_scope_invalid");
  });
});
