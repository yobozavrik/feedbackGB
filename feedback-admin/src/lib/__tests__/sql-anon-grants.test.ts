import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Security guard (H0 / I7): no feedbackgb table may be left granted to the
 * public `anon` (or `authenticated`) role without being either revoked again
 * or protected by row-level security.
 *
 * The anon key is the public NEXT_PUBLIC_SUPABASE_ANON_KEY shipped in the
 * browser bundle. A table granted SELECT/INSERT to anon and left without RLS
 * is readable/writable by anyone via direct PostgREST, bypassing the Next.js
 * API, its auth middleware and rate limits (see 031_lock_user_interactions.sql
 * and the earlier 019_revoke_anon_data_access.sql). This test scans the
 * canonical migration set so a future migration re-introducing such a grant
 * fails CI instead of silently re-opening the leak.
 */

// This test lives in feedback-admin/src/lib/__tests__/ ; the canonical
// migrations are in feedback-admin/supabase/ (../../../supabase).
const SUPABASE_DIR = fileURLToPath(new URL("../../../supabase", import.meta.url));

function migrationSql(): string {
  const files = readdirSync(SUPABASE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(`${SUPABASE_DIR}/${f}`, "utf8")).join("\n");
}

// grant ... on feedbackgb.<table> to <roles incl. anon|authenticated>
const GRANT_RE =
  /grant\s+[^;]*?\bon\s+feedbackgb\.(\w+)\s+to\s+[^;]*?\b(?:anon|authenticated)\b/gi;
// revoke ... on feedbackgb.<table> from <roles incl. anon|authenticated>
const REVOKE_RE =
  /revoke\s+[^;]*?\bon\s+feedbackgb\.(\w+)\s+from\s+[^;]*?\b(?:anon|authenticated)\b/gi;
// alter table feedbackgb.<table> enable row level security
const RLS_RE =
  /alter\s+table\s+feedbackgb\.(\w+)\s+enable\s+row\s+level\s+security/gi;

function collect(re: RegExp, sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(re)) out.add(m[1]!.toLowerCase());
  return out;
}

describe("supabase migrations: anon/authenticated grant hygiene", () => {
  const sql = migrationSql();
  const granted = collect(GRANT_RE, sql);
  const revoked = collect(REVOKE_RE, sql);
  const rlsOn = collect(RLS_RE, sql);

  it("every table granted to anon/authenticated is later revoked or protected by RLS", () => {
    const unprotected = [...granted].filter(
      (t) => !revoked.has(t) && !rlsOn.has(t),
    );
    expect(unprotected).toEqual([]);
  });

  it("user_interactions specifically is revoked from anon and has RLS enabled (H0)", () => {
    expect(granted.has("user_interactions")).toBe(true); // 013 granted it
    expect(revoked.has("user_interactions")).toBe(true); // 031 revokes it
    expect(rlsOn.has("user_interactions")).toBe(true); // 031 enables RLS
  });
});
