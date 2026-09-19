import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
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
  return { stores: (storesResult.data ?? []) as ScheduleStore[], sellers: (sellersResult.data ?? []) as ScheduleSeller[], error: null };
}

export default async function NetworkSchedulesPage() {
  const { stores, sellers, error } = await fetchScheduleDirectory();
  return (
    <AdminPageContainer
      title="Графіки роботи"
      subTitle="Планування змін працівників магазинів"
    >
      <ScheduleWorkspace stores={stores} sellers={sellers} bootstrapError={error} />
    </AdminPageContainer>
  );
}
