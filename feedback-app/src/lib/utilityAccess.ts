import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";

export type UtilityDb = NonNullable<ReturnType<typeof getServerSupabase>>;
export type UtilityActor = { id: string; role: "seller" | "admin" | "super_admin"; homeStoreId: number | null };

export async function utilityContext(): Promise<{ db: UtilityDb; actor: UtilityActor } | { error: string; status: number }> {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") return { error: "feature_disabled", status: 404 };
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return { error: "unauthenticated", status: 401 };
  const db = getServerSupabase();
  if (!db) return { error: "backend_unavailable", status: 503 };
  const { data: user, error } = await db.from("users")
    .select("id,role,is_active,store_id").eq("id", session.uid).maybeSingle();
  if (error || !user || !user.is_active || !["seller", "admin", "super_admin"].includes(user.role)) {
    return { error: "forbidden", status: 403 };
  }
  return { db, actor: { id: user.id, role: user.role, homeStoreId: user.store_id } };
}

export async function canUseUtilityStore(db: UtilityDb, actor: UtilityActor, storeId: number): Promise<boolean> {
  if (!Number.isInteger(storeId) || storeId <= 0) return false;
  const { data: store, error: storeError } = await db.from("v_stores")
    .select("id,is_active").eq("id", storeId).maybeSingle();
  if (storeError || !store || !store.is_active) return false;
  if (actor.role !== "seller" || actor.homeStoreId === storeId) return true;
  const { data: permission, error } = await db.from("seller_store_permissions")
    .select("id").eq("seller_id", actor.id).eq("store_id", storeId)
    .is("revoked_at", null).maybeSingle();
  return !error && !!permission;
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
