import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/042_analytics_year_backfill_foundation.sql"), "utf8");
const rollback = readFileSync(resolve(process.cwd(), "supabase/042_analytics_year_backfill_rollback.sql"), "utf8");
const withoutComments = sql.replace(/--[^\n]*/g, "");
/** These are TEXT contract guards, not a Postgres execution or race proof. */
describe("042 year foundation static contract", () => {
  it("is transactional and additive", () => { expect(withoutComments.trim()).toMatch(/^begin;/); expect(withoutComments.trim()).toMatch(/commit;$/); expect(withoutComments).not.toMatch(/\b(drop|truncate|delete)\b/i); });
  it("creates only feedbackgb objects", () => { const names = [...withoutComments.matchAll(/create (?:table|view|function)\s+([\w.]+)/g)].map(m => m[1]); expect(names).toHaveLength(6); expect(names.every(n => n.startsWith("feedbackgb."))).toBe(true); });
  it("does not replace legacy RPCs or views", () => { expect(withoutComments).not.toMatch(/create or replace/i); expect(withoutComments).not.toMatch(/create (?:view|function) feedbackgb\.(?:v_foodcost_sales_backfill|seed_foodcost|claim_foodcost)/); });
  it("starts from fixed2026 baseline without a rolling120-day cutoff", () => { expect(withoutComments).toContain("date '2026-01-01'"); expect(withoutComments).not.toMatch(/v_today\s*-\s*120/); expect(withoutComments).toContain("j.business_date>=v_start"); });
  it("keeps ingestion disabled and historical membership unknown", () => { expect(withoutComments).toContain("'Europe/Kyiv',false,7"); expect(withoutComments).toContain("historical_roster_verified=false"); expect(withoutComments).not.toMatch(/valid_from/); });
  it.each(["analytics_source_policies", "analytics_spot_observations"])("enables RLS on %s", table => expect(withoutComments).toContain(`alter table feedbackgb.${table} enable row level security`));
  it("revokes inherited relation privileges including service_role", () => { expect(withoutComments.match(/from public,anon,authenticated,service_role/g)).toHaveLength(4); expect(withoutComments).not.toMatch(/grant (?:insert|update|delete|all)/i); });
  it("uses qualified safe function search paths", () => expect(withoutComments.match(/security definer set search_path = feedbackgb, pg_temp/g)).toHaveLength(2));
  it("protects idempotent seed and existing queue histories", () => { expect(withoutComments).toContain("on conflict (business_date,spot_id) do nothing"); expect(withoutComments).toContain("where r.business_date=d::date and r.spot_id=s.id and r.status='completed'"); expect(withoutComments).not.toMatch(/update feedbackgb\.foodcost_sales_backfill_jobs[^;]*attempt_count\s*=\s*0/s); });
  it("retains lease, retry exhaustion and SKIP LOCKED guards", () => { for (const text of ["for update skip locked limit 1", "v_job.attempt_count>=8", "v_reaped>=128", "interval '15 minutes'", "a.owner_token=v_job.owner_token", "j.business_date<v_today"]) expect(withoutComments).toContain(text); });
  it("guards roster, duplicate IDs, null IDs and observation age", () => { expect(withoutComments.match(/array_position\(p_spot_ids,null\)/g)).toHaveLength(2); expect(withoutComments).toContain("p_checked_at<v_now-interval '5 minutes'"); expect(withoutComments.match(/count\(distinct id\)/g)).toHaveLength(2); });
  it("coverage uses distinct completed cells and fixed statement time", () => { expect(withoutComments).toContain("select distinct r.business_date,r.spot_id"); expect(withoutComments).toContain("r.completed_at<=statement_timestamp()"); expect(withoutComments.match(/security_invoker=true/g)).toHaveLength(2); });
  it("rollback refuses activated/observed foundation and keeps original facts", () => { expect(rollback).toContain("analytics_year_rollback_refused_after_activation_or_observation"); expect(rollback).toContain("access exclusive mode"); expect(rollback).not.toMatch(/drop (?:table|view|function) feedbackgb\.foodcost/); expect(rollback).not.toMatch(/cascade/i); });
});
