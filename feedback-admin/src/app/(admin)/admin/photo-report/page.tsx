import { getServerSupabase } from "@/lib/supabase";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import type { PhotoReportStore } from "@/lib/photoReport";
import { PhotoReportClient } from "./photo-report-client";

export const dynamic = "force-dynamic";

async function fetchPhotoReportData(): Promise<{
  stores: PhotoReportStore[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) return { stores: [], error: "Supabase ще не налаштовано" };

  const storesRes = await supabase
    .from("v_stores")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  return {
    stores: (storesRes.data as PhotoReportStore[]) ?? [],
    error: storesRes.error?.message ?? null,
  };
}

export default async function PhotoReportPage() {
  const { stores, error } = await fetchPhotoReportData();
  return (
    <AdminPageContainer
      title="Фото звіт"
      subTitle="Щоденний контроль надходження фото по активних магазинах."
    >
      <PhotoReportClient stores={stores} error={error} />
    </AdminPageContainer>
  );
}
