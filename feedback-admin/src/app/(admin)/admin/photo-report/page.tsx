import { getServerSupabase } from "@/lib/supabase";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { kyivDay, type PhotoReportEntry, type PhotoReportStore } from "@/lib/photoReport";
import { PhotoReportClient } from "./photo-report-client";

export const dynamic = "force-dynamic";

async function fetchPhotoReportData(): Promise<{
  stores: PhotoReportStore[];
  entries: PhotoReportEntry[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) return { stores: [], entries: [], error: "Supabase ще не налаштовано" };

  const date = kyivDay(new Date().toISOString());
  const from = new Date(`${date}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const until = new Date(`${date}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 2);
  const [storesRes, reportsRes] = await Promise.all([
    supabase
      .from("v_stores")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("feedback_feed")
      .select("created_at,store_id,store_name,user_full_name,photo_url,photo_urls")
      .eq("category", "photo_report")
      .gte("created_at", from.toISOString())
      .lt("created_at", until.toISOString())
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  return {
    stores: (storesRes.data as PhotoReportStore[]) ?? [],
    entries: (reportsRes.data as PhotoReportEntry[]) ?? [],
    error: storesRes.error?.message ?? reportsRes.error?.message ?? null,
  };
}

export default async function PhotoReportPage() {
  const { stores, entries, error } = await fetchPhotoReportData();
  return (
    <AdminPageContainer
      title="Фото звіт"
      subTitle="Щоденний контроль надходження фото по активних магазинах."
    >
      <PhotoReportClient stores={stores} entries={entries} error={error} />
    </AdminPageContainer>
  );
}
