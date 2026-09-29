import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/043_poster_receipt_archive_foundation.sql"), "utf8").replace(/--[^\n]*/g, "");
const tables = ["poster_receipt_import_runs", "poster_receipt_source_payloads", "poster_client_snapshots",
  "poster_receipt_identities", "poster_receipt_versions", "poster_receipt_line_versions", "poster_receipt_field_registry"];
const rollback = readFileSync(resolve(process.cwd(), "supabase/043_poster_receipt_archive_rollback.sql"), "utf8");
/** Static regression guards only: NOT Postgres execution, ACL or concurrency proof. */
describe("043 receipt foundation static contract", () => {
  it("is transactional and does not mutate existing objects", () => { expect(sql.trim()).toMatch(/^begin;/); expect(sql.trim()).toMatch(/commit;$/); expect(sql).not.toMatch(/create or replace|truncate|drop|update feedbackgb|insert into/i); });
  it("creates objects only in feedbackgb", () => { const names = [...sql.matchAll(/create (?:table|function)\s+([\w.]+)/g)].map(m => m[1]); expect(names).toHaveLength(8); expect(names.every(n => n.startsWith("feedbackgb."))).toBe(true); });
  it.each(tables)("enables RLS on %s", table => expect(sql).toContain(`alter table feedbackgb.${table} enable row level security`));
  it("leaves write/read access disabled until validated RPC exists", () => { expect(sql).toContain("from public,anon,authenticated,service_role"); expect(sql).not.toMatch(/\bgrant\b/i); });
  it("preserves global identity and repeated ordered product lines", () => { expect(sql).toContain("unique (account_id,transaction_id)"); expect(sql).toContain("primary key (receipt_version_id,source_line_no)"); expect(sql).not.toMatch(/unique\s*\(product_id\)/); });
  it("stores only encrypted private source and enforces AES-GCM sizes", () => { expect(sql).not.toMatch(/\bjsonb\b|phone|email|first_name|last_name/); for (const value of ["octet_length(nonce)=12", "octet_length(auth_tag)=16", "aes-256-gcm-v1"]) expect(sql).toContain(value); });
  it("binds references to the same account, run and endpoint", () => { expect(sql.match(/references feedbackgb.poster_receipt_source_payloads\(id,run_id,account_id,endpoint\)/g)).toHaveLength(2); expect(sql).toContain("references feedbackgb.poster_client_snapshots(id,run_id,account_id,client_id)"); });
  it("rejects unknown-null client states rather than passing SQL CHECK null", () => expect(sql).toContain("client_snapshot_id is null)) is true"));
  it("does not guess monetary basis or normalized close date", () => { expect(sql).toContain("default 'unverified'"); expect(sql).toContain("source_date_close text not null"); expect(sql).toContain("closed_at timestamptz, business_date date"); });
  it("protects immutable source, snapshot, receipt and line tables", () => expect(sql.match(/before update or delete on feedbackgb/g)).toHaveLength(4));
  it("does not publish partial analytics or enable unmeasured partitions", () => expect(sql).not.toMatch(/create view|partition by|create policy/i));
  it("includes the extended categories receipt header without copying private plaintext", () => { for (const field of ["source_date_start", "source_date_start_new", "source_status", "source_user_id", "paid_ewallet_source", "tax_sum_source", "source_processing_status", "source_service_mode", "total_profit_netto_source"]) expect(sql).toContain(field); expect(sql).toContain("source_reason text"); });
  it("keeps detailed line cost/tax/bonus projections and unverified quantity basis", () => { for (const field of ["bonus_accrual_source", "cost_netto_source", "profit_netto_source", "source_tax_fiscal", "source_fiscal_company_id", "product_price_source", "quantity_basis"]) expect(sql).toContain(field); });
  it("refuses a partial prior foundation before DDL", () => { expect(sql).toContain("receipt_foundation_already_exists"); expect(sql).toContain("receipt_schema_missing"); expect(sql).not.toMatch(/create table if not exists/); });
  it("refuses destructive rollback after first data and does not cascade", () => { expect(rollback).toContain("receipt_rollback_refused_nonempty"); expect(rollback).toContain("access exclusive mode"); expect(rollback).not.toMatch(/\bcascade\b/i); for (const table of tables) expect(rollback).toContain(`exists(select 1 from feedbackgb.${table})`); });
});
