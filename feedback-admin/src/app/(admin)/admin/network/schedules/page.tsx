import { cookies } from "next/headers";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";
import { ScheduleWorkspace, type ScheduleSeller, type ScheduleStore } from "./schedule-workspace";

export const dynamic = "force-dynamic";

async function fetchScheduleDirectory(): Promise<{ stores: ScheduleStore[]; sellers: ScheduleSeller[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) return { stores: [], sellers: [], error: "Supabase ще не налаштовано" };
  const [storesResult, sellersResult] = await Promise.all([
    supabase.from("v_stores").select("id, name").eq("is_active", true).order("name", { ascending: true }),
    supabase.from("users").select("id, full_name, display_label, store_id").eq("role", "seller").eq("is_active", true).order("full_name", { ascending: true }),
  ]);
  if (storesResult.error) return { stores: [], sellers: [], error: storesResult.error.message };
  if (sellersResult.error) return { stores: [], sellers: [], error: sellersResult.error.message };
  const sellerIds = (sellersResult.data ?? []).map((seller) => seller.id);
  const permissionsResult = sellerIds.length
    ? await supabase.from("seller_store_permissions").select("seller_id, store_id").in("seller_id", sellerIds).is("revoked_at", null)
    : { data: [], error: null };
  if (permissionsResult.error) return { stores: [], sellers: [], error: permissionsResult.error.message };
  const replacementStoresBySeller = new Map<string, number[]>();
  for (const permission of permissionsResult.data ?? []) {
    replacementStoresBySeller.set(permission.seller_id, [...(replacementStoresBySeller.get(permission.seller_id) ?? []), permission.store_id]);
  }
  const sellers = (sellersResult.data ?? []).map((seller) => ({ ...seller, replacement_store_ids: replacementStoresBySeller.get(seller.id) ?? [] })) as ScheduleSeller[];
  return { stores: (storesResult.data ?? []) as ScheduleStore[], sellers, error: null };
}

export default async function NetworkSchedulesPage() {
  const { stores, sellers, error } = await fetchScheduleDirectory();
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  return (
    <AdminPageContainer
      title="Графіки роботи"
      subTitle="Планування змін працівників магазинів"
    >
      <ScheduleWorkspace stores={stores} sellers={sellers} bootstrapError={error} canManagePeriod={Boolean(session && isSuperAdmin(session.role))} />
    </AdminPageContainer>
  );
}
