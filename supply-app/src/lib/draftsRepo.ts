import { getServerSupabase } from "@/lib/supabase";

export interface DraftCartItem {
  product_id: number;
  quantity: number;
  name?: string;
  unit?: string | null;
  photo_url?: string | null;
}

export interface DraftRow {
  id: string;
  user_id: string;
  facility_id: string | null;
  category: "consumables_request";
  cart_items: DraftCartItem[];
  comment: string | null;
  updated_at: string;
}

/**
 * Read (or lazily create) the caller's consumables draft. Returns null only if
 * Supabase isn't configured — a missing draft yields a fresh empty row so the
 * client doesn't have to distinguish "no draft yet" from "draft with 0 items".
 */
export async function getOrCreateConsumablesDraft(
  userId: string,
  facilityId: string | null,
): Promise<DraftRow | null> {
  const supabase = getServerSupabase();
  if (!supabase) return null;

  const { data: existing } = await supabase
    .from("feedback_drafts")
    .select("id, user_id, facility_id, category, cart_items, comment, updated_at")
    .eq("user_id", userId)
    .eq("category", "consumables_request")
    .maybeSingle();
  if (existing) return existing as DraftRow;

  const { data: inserted, error } = await supabase
    .from("feedback_drafts")
    .insert({ user_id: userId, facility_id: facilityId, category: "consumables_request" })
    .select("id, user_id, facility_id, category, cart_items, comment, updated_at")
    .single();
  if (error || !inserted) {
    console.error("[supply] draft create", { code: error?.code });
    return null;
  }
  return inserted as DraftRow;
}

/** Overwrite items + comment for the caller's own draft. Server owns identity. */
export async function updateConsumablesDraft(
  userId: string,
  patch: { cart_items?: DraftCartItem[]; comment?: string | null },
): Promise<DraftRow | null> {
  const supabase = getServerSupabase();
  if (!supabase) return null;

  const update: Record<string, unknown> = {};
  if (patch.cart_items !== undefined) update.cart_items = patch.cart_items;
  if (patch.comment !== undefined) update.comment = patch.comment;
  if (Object.keys(update).length === 0) {
    return getOrCreateConsumablesDraft(userId, null);
  }

  const { data, error } = await supabase
    .from("feedback_drafts")
    .update(update)
    .eq("user_id", userId)
    .eq("category", "consumables_request")
    .select("id, user_id, facility_id, category, cart_items, comment, updated_at")
    .maybeSingle();
  if (error) {
    console.error("[supply] draft update", { code: error.code });
    return null;
  }
  return (data as DraftRow) ?? null;
}

export async function deleteConsumablesDraft(userId: string): Promise<boolean> {
  const supabase = getServerSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("feedback_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("category", "consumables_request");
  if (error) {
    console.error("[supply] draft delete", { code: error.code });
    return false;
  }
  return true;
}
