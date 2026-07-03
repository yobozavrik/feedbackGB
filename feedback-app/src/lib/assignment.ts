import type { SupabaseClient } from "@supabase/supabase-js";

// eslint config doesn't ship the @typescript-eslint plugin, so plain `any`
// is fine here and we don't need a disable comment (matches supabase.ts).
type LooseClient = SupabaseClient<any, any, any>;

/**
 * Active admin_directions rows for one (category, store-scope) pair. A
 * direction can now have more than one active admin (016_admin_directions_
 * allow_multiple.sql dropped the old one-admin-per-scope unique index), so
 * this returns every match instead of assuming at most one.
 */
async function queryActiveAdminIds(
  supabase: LooseClient,
  category: string,
  storeId: number | null,
): Promise<string[]> {
  const query = supabase
    .from("admin_directions")
    .select("admin_id")
    .eq("category", category)
    .eq("is_active", true);
  const scoped = storeId != null ? query.eq("store_id", storeId) : query.is("store_id", null);
  const { data, error } = await scoped;
  if (error) {
    console.warn("[assignment] direction lookup failed", { code: error.code, storeId });
    return [];
  }
  return ((data ?? []) as Array<{ admin_id: string }>).map((r) => r.admin_id);
}

/**
 * Resolves the admin auto-assigned to a newly-created feedback row, based
 * on feedbackgb.admin_directions (see
 * feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md).
 *
 * Resolution order:
 *   1. Active directions for (category, store_id = storeId) — exact store.
 *   2. Active directions for (category, store_id IS NULL) — "all stores".
 *
 * At each step:
 *   - Exactly 1 active admin -> auto-assign them directly.
 *   - 0 active admins -> move to the next step (or return null if this was
 *     already the last step).
 *   - 2+ active admins -> ambiguous by design (several admins share this
 *     direction). Returns null rather than guessing: the item stays
 *     unassigned and shows up as a shared "available" item for every admin
 *     in that direction on the "Мої завдання" page. Whoever picks it up
 *     first claims it via the existing reassign control in FeedDrawer.
 *
 * Never throws: a lookup failure must not block feedback submission. On
 * error, logs and falls back to unassigned.
 */
export async function resolveAssignedAdmin(
  supabase: LooseClient,
  category: string,
  storeId: number | null,
): Promise<string | null> {
  try {
    if (storeId != null) {
      const exact = await queryActiveAdminIds(supabase, category, storeId);
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return null;
      // exact.length === 0 -> fall through to the all-stores scope below.
    }

    const allStores = await queryActiveAdminIds(supabase, category, null);
    if (allStores.length === 1) return allStores[0];
    return null;
  } catch (err) {
    console.warn("[assignment] resolveAssignedAdmin threw", err);
    return null;
  }
}
