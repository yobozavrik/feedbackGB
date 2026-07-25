import { getServerSupabase } from "@/lib/supabase";
import { getZakupkiSupabase } from "@/lib/zakupkiDb";

/**
 * Bridges a supply-app facility to its zakupki workshop. The two schemas
 * share no foreign key — the only link is the Poster storage id, stored as
 * `facilities.crm_warehouse_id` on one side and `workshops.poster_storage_id`
 * on the other (see docs/supply-app/STITCH_BRIEF_RAW_MATERIALS.md history).
 */
export async function getWorkshopIdForFacility(facilityId: string | null): Promise<string | null> {
  if (!facilityId) return null;

  const supabase = getServerSupabase();
  if (!supabase) return null;
  const { data: facility } = await supabase
    .from("facilities")
    .select("crm_warehouse_id")
    .eq("id", facilityId)
    .maybeSingle();
  const crmWarehouseId = (facility as { crm_warehouse_id: number | null } | null)?.crm_warehouse_id;
  if (crmWarehouseId == null) return null;

  const zakupki = getZakupkiSupabase();
  if (!zakupki) return null;
  const { data: workshop } = await zakupki
    .from("workshops")
    .select("id")
    .eq("poster_storage_id", crmWarehouseId)
    .eq("is_active", true)
    .maybeSingle();
  return (workshop as { id: string } | null)?.id ?? null;
}

/**
 * Bridges a supply-app (feedbackgb) session to its zakupki.employees row —
 * required for zakupki.requests.employee_id (NOT NULL). No auto-provisioning:
 * a super_admin links each real zakupki employee to their supply-app login
 * by hand (see 20260725_001_zakupki_supply_app_bridge.sql). Returns null
 * until that link exists; callers must surface a clear error, not a 500.
 */
export async function getZakupkiEmployeeId(workshopId: string, feedbackgbUserId: string): Promise<string | null> {
  const zakupki = getZakupkiSupabase();
  if (!zakupki) return null;
  const { data } = await zakupki
    .from("employees")
    .select("id")
    .eq("feedbackgb_user_id", feedbackgbUserId)
    .eq("workshop_id", workshopId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
