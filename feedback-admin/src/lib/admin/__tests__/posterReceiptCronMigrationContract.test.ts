import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/049_poster_receipt_cron_lease.sql"), "utf8");
const readback = readFileSync(resolve(process.cwd(),
  "supabase/049_poster_receipt_cron_lease_readback.sql"), "utf8");
const rollback = readFileSync(resolve(process.cwd(),
  "supabase/049_poster_receipt_cron_lease_rollback.sql"), "utf8");

describe("049 receipt cron lease contract", () => {
  it("creates one account/day journal with RLS and no direct service access", () => {
    expect(sql).toContain("primary key (account_id, business_date)");
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/revoke all on table feedbackgb\.poster_receipt_cron_days\s+from public, anon, authenticated, service_role/);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete).*poster_receipt_cron_days/is);
  });

  it("serializes claims, bounds leases and permits takeover only after expiry", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("p_lease_seconds not between 60 and 600");
    expect(sql).toContain("poster_receipt_cron_days.lease_expires_at <= clock_timestamp()");
    expect(sql).toContain("'status', 'in_progress'");
  });

  it("refuses open Kyiv days and skips an already accepted archive day", () => {
    expect(sql).toContain("clock_timestamp() at time zone 'Europe/Kyiv'");
    expect(sql).toContain("status = 'accepted'");
    expect(sql).toContain("receipt_cron_run_ambiguous");
    expect(sql).toContain("if v_run_count > 1");
    expect(sql).toContain("'status', 'already_verified'");
  });

  it("completes only against a matching accepted run and supports exact replay", () => {
    expect(sql).toContain("and source_count = p_receipt_count");
    expect(sql).toContain("status = 'running' and owner_token = p_owner_token");
    expect(sql).toContain("status = 'verified' and run_id = p_run_id");
  });

  it("exposes only service-role RPCs and includes an ACL readback", () => {
    expect(sql.match(/grant execute on function feedbackgb\./g)).toHaveLength(3);
    expect(sql.match(/to service_role;/g)).toHaveLength(3);
    expect(readback).toContain("'anon_claim_denied'");
    expect(readback).toContain("'authenticated_claim_denied'");
    expect(readback).toContain("'service_direct_table_denied'");
  });

  it("provides a non-cascading rollback that refuses to erase a used journal", () => {
    expect(rollback).toContain("access exclusive mode");
    expect(rollback).toContain("receipt_cron_rollback_refused_nonempty");
    expect(rollback).not.toMatch(/\bcascade\b/i);
  });
});
