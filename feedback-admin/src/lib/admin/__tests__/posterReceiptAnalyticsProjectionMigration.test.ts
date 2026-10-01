import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/054_poster_receipt_analytics_projection.sql"), "utf8").toLowerCase();

describe("054 receipt analytics projection migration", () => {
  it("keeps projection private and service RPC-only", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/revoke all on table[\s\S]+service_role/);
    expect(sql).toMatch(/grant execute on function feedbackgb\.project_poster_receipt_analytics_day[\s\S]+service_role/);
    expect(sql).not.toMatch(/grant select[\s\S]+poster_receipt_(analytics|line_analytics)/);
  });

  it("uses exact major-to-minor conversion and reconciles header with lines", () => {
    expect(sql).toContain("p_value::numeric * 100");
    expect(sql).toContain("receipt_analytics_reconciliation_failed");
    expect(sql).toContain("paid_minor_total = line_paid_minor_total");
  });

  it("excludes explicit fiscal returns and non-purchases from penetration", () => {
    expect(sql).toContain("when r.source_fiscal_status=2 then 'fiscal_return'");
    expect(sql).toContain("when feedbackgb._poster_receipt_major_to_minor(r.paid_source)<=0 then 'non_positive_paid'");
    expect(sql).toContain("feedbackgb._poster_receipt_quantity(l.quantity_source)>0");
  });

  it("projects future accepted runs atomically and supports idempotent backfill", () => {
    expect(sql).toContain("after update of status on feedbackgb.poster_receipt_import_runs");
    expect(sql).toContain("perform pg_advisory_xact_lock");
    expect(sql).toContain("'replayed',true");
  });

  it("preserves immutable derived facts and exposes no customer identity", () => {
    expect(sql).toContain("poster_receipt_analytics_fact_immutable");
    expect(sql).toContain("has_identified_client boolean");
    expect(sql).not.toContain("client_id bigint not null");
  });
});
