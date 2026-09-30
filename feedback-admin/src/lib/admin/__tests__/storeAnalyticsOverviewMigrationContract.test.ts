import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase", "050_store_analytics_overview.sql"), "utf8").toLowerCase();

describe("050 store analytics overview migration", () => {
  it("creates only a feedbackgb aggregate reader", () => {
    expect(sql).toContain("create function feedbackgb.read_store_analytics_overview");
    expect(sql).not.toContain("create table public.");
    expect(sql).not.toContain("create view public.");
  });

  it("keeps raw receipt and customer payload inaccessible", () => {
    expect(sql).not.toContain("raw_body'");
    expect(sql).not.toContain("source_payloads p");
    expect(sql).not.toContain("poster_client_snapshots");
  });

  it("returns no partial monetary KPI", () => {
    expect(sql).toContain("case when v_completed = v_expected then jsonb_build_object");
    expect(sql).toContain("else null end");
    expect(sql).toContain("'missingcount'");
  });

  it("does not invent average check before receipt money verification", () => {
    expect(sql).toContain("'averagecheckminor', null");
    expect(sql).toContain("'receipt_money_basis_unverified'");
  });

  it("restricts execution to service role", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = feedbackgb, pg_temp");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
  });
});
