import { getServerSupabase } from "@/lib/supabase";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import type { PhotoReportEntry, PhotoReportStore } from "@/lib/photoReport";
import { PhotoReportClient } from "./photo-report-client";

export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 31;

async function fetchPhotoReportData(): Promise<{
  stores: PhotoReportStore[];
  entries: PhotoReportEntry[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) return { stores: [], entries: [], error: "Supabase ще не налаштовано" };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(15000),
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
      subTitle={`Щоденний контроль надходження фото по активних магазинах. Дані за останні ${LOOKBACK_DAYS} день.`}
    >
      <PhotoReportClient stores={stores} entries={entries} error={error} />
    </AdminPageContainer>
  );
}
