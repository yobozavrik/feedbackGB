import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase";
import { SUPPLY_SESSION_COOKIE, type SupplyRole, verifySupplySession, type SupplySession } from "@/lib/session";
import { isSupplySchemaReady } from "@/lib/supplySchema";

export interface SupplyUser {
  id: string;
  name: string;
  role: SupplyRole;
  facilityId: string | null;
  facilityName: string | null;
}

const ROLES = ["supply_worker", "admin", "super_admin"];

/**
 * Core resolver shared by the page guard and the API guard. Re-checks live
 * authority (is_active, app access, membership) from the DB every call — the
 * cookie is only a hint. Returns null for any failure; callers decide whether
 * to redirect (pages) or answer 401 (API).
 */
async function resolveSupplyUser(session: SupplySession | null): Promise<SupplyUser | null> {
  if (!session) return null;
  const supabase = getServerSupabase();
  if (!supabase || !(await isSupplySchemaReady(supabase))) return null;

  const { data } = await supabase
    .from("users")
    .select("id, full_name, display_label, role, is_active")
    .eq("id", session.uid)
    .maybeSingle();
  const role = data?.role as SupplyRole | undefined;
  if (!data?.is_active || !role || !ROLES.includes(role)) return null;

  const { data: appAccess } = await supabase
    .from("user_app_access")
    .select("user_id")
    .eq("user_id", data.id)
    .eq("app_key", "supply_app")
    .eq("is_active", true)
    .maybeSingle();
  if (!appAccess) return null;

  const { data: memberships } = await supabase
    .from("user_facility_memberships")
    .select("facility_id")
    .eq("user_id", data.id)
    .eq("is_active", true);
  const facilityIds = (memberships ?? []).map((m: { facility_id: string }) => m.facility_id);
  const { data: facilities } = facilityIds.length
    ? await supabase.from("facilities").select("id, name").in("id", facilityIds).eq("is_active", true)
    : { data: [] as { id: string; name: string }[] };
  const activeFacilities = facilities ?? [];
  // Supply workers must have a facility; admins/super_admins may have none.
  if (role === "supply_worker" && activeFacilities.length === 0) return null;
  const facility =
    activeFacilities.find((item) => item.id === session.facility_id) ?? activeFacilities[0] ?? null;

  return {
    id: data.id as string,
    name: (data.display_label ?? data.full_name) as string,
    role,
    facilityId: facility?.id ?? null,
    facilityName: facility?.name ?? null,
  };
}

/** Page guard: redirects unauthenticated/unauthorized users out to the PIN pad. */
export async function requireSupplyUser(): Promise<SupplyUser> {
  const session = await verifySupplySession(cookies().get(SUPPLY_SESSION_COOKIE)?.value);
  if (!session) redirect("/api/auth/logout?next=/");
  const user = await resolveSupplyUser(session);
  if (!user) redirect("/api/auth/logout?next=/");
  return user;
}

/** API guard: returns the user or null (caller answers 401), never redirects. */
export async function getSupplyApiUser(): Promise<SupplyUser | null> {
  const session = await verifySupplySession(cookies().get(SUPPLY_SESSION_COOKIE)?.value);
  return resolveSupplyUser(session);
}
