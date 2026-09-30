import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/053_store_catalog_comparison_total_fix.sql"), "utf8");
const readback = readFileSync(resolve(process.cwd(), "supabase/053_store_catalog_comparison_total_fix_readback.sql"), "utf8");

describe("migration 053 comparison total repair", () => {
  it("repairs the applied function definition forward-only", () => {
    expect(sql).toContain("pg_get_functiondef");
    expect(sql).toContain("store_catalog_comparison_fix_unexpected_definition");
    expect(sql).toContain("if v_compare_complete then");
    expect(sql).toContain("if v_current_complete then");
    expect(sql).not.toMatch(/drop\s+function/i);
  });

  it("readback covers the reported incomplete-current regression and a complete period reconciliation", () => {
    expect(readback).toContain("date '2026-09-23', date '2026-09-29'");
    expect(readback).toContain("date '2026-09-16', date '2026-09-22'");
    expect(readback).toContain("categories_reconcile");
  });
});
