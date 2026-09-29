import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/044_poster_receipt_atomic_import.sql"), "utf8").replace(/--[^\n]*/g, "");
/** TEXT guards only. Runtime SQL semantics, ACL, rollback/race tests still require PostgreSQL. */
describe("044 atomic receipt import static contract", () => {
  it("is transactional, additive and does not replace applied 043 objects", () => { expect(sql.trim()).toMatch(/^begin;/); expect(sql.trim()).toMatch(/commit;$/); expect(sql).not.toMatch(/create or replace|\bdrop\b|\btruncate\b/); });
  it("starts disabled and gate runs before inserts", () => { expect(sql).toContain("values(true,false)"); expect(sql.indexOf("receipt_ingestion_disabled")).toBeLessThan(sql.indexOf("insert into feedbackgb.poster_receipt_import_runs")); });
  it("allows execution only through service-role RPC, not table grants", () => { expect(sql).toContain("security definer set search_path=feedbackgb,pg_temp"); expect(sql.match(/grant execute on function feedbackgb.import_poster_receipt_bundle\(jsonb\) to service_role/g)).toHaveLength(1); expect(sql).not.toMatch(/grant (select|insert|update|all)/i); });
  it("uses network-day scope rather than invented Poster spot filter", () => { expect(sql).toContain("source_spot_ids bigint[]"); expect(sql).toContain("v_spot=any(v_spots)"); expect(sql).toContain("cardinality(v_spots)>100"); });
  it("serializes run IDs before account identity races", () => expect(sql.indexOf("'poster-receipt-run:'")).toBeLessThan(sql.indexOf("'poster-receipt-account:'")));
  it("requires matching manifest for a replay", () => { expect(sql).toContain("v_existing.bundle_sha256=v_hash"); expect(sql).toContain("receipt_run_conflict"); expect(sql).toContain("pg_catalog.sha256"); });
  it("old accepted replay is checked before fresh-bundle expiry", () => expect(sql.indexOf("'replayed',true")).toBeLessThan(sql.indexOf("receipt_bundle_stale")));
  it("checks complete pages, row ordinals and total source count", () => { for (const value of ["receipt_bundle_incomplete", "source_page>v_pages", "sum(source_item_count)", "v_ordinal between 1 and p.source_item_count", "jsonb_array_length(p_bundle->'receipts')<>v_count"]) expect(sql).toContain(value); });
  it("requires referenced client enrichment and forbids unrelated profiles", () => { expect(sql).toContain("receipt_client_incomplete"); expect(sql).toContain("r.client_snapshot_id=s.id"); expect(sql).toContain("s.source_payload_id=p.id)<>1"); });
  it("preserves repeated lines with positional ordinals", () => { expect(sql).toContain("v_ordinal:=v_ordinal+1"); expect(sql).toContain("'source_line_no',v_ordinal"); expect(sql).not.toMatch(/on conflict \(.*product_id/); });
  it("publishes after all checks and never rewrites immutable receipt versions", () => { const index = sql.indexOf("set status='accepted'"); expect(index).toBeGreaterThan(sql.indexOf("r.client_snapshot_id=s.id")); expect(sql).not.toContain("update feedbackgb.poster_receipt_versions"); });
  it("does not pretend projection money/time/units are verified", () => { expect(sql).toContain("'money_basis','unverified'"); expect(sql).toContain("'quantity_basis','unverified'"); expect(sql).not.toContain("'closed_at'"); });
  it("protects accepted run metadata from future changes", () => { expect(sql).toContain("if old.status='accepted'"); expect(sql).toContain("receipt_accepted_run_immutable"); });
  it("does not store a plaintext JSONB payload column", () => expect(sql).not.toMatch(/add column .*jsonb/));
});
