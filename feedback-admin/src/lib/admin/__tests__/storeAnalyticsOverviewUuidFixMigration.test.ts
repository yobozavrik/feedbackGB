import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase",
  "051_store_analytics_overview_uuid_aggregate_fix.sql"), "utf8").toLowerCase();

describe("051 store analytics UUID aggregate repair", () => {
  it("is forward-only and requires the applied 050 function", () => {
    expect(sql).toContain("to_regprocedure(");
    expect(sql).toContain("store_analytics_overview_missing");
    expect(sql).not.toContain("drop function");
  });

  it("replaces exactly both unsupported max(uuid) calls", () => {
    expect(sql).toContain("v_occurrences <> 2");
    expect(sql).toContain("replace(v_definition, 'max(r.id)', 'min(r.id::text)::uuid')");
    expect(sql).toContain("store_analytics_uuid_fix_failed");
  });

  it("does not create a global custom uuid aggregate", () => {
    expect(sql).not.toContain("create aggregate");
    expect(sql).not.toContain("create function feedbackgb.max");
  });
});
