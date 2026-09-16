import { getServerSupabase } from "@/lib/supabase";
import type { PhotoReportStore } from "@/lib/photoReport";
import { PhotoReportWorkspace } from "./photo-report-workspace";

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

export default async function PhotoReportPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const { stores, error } = await fetchPhotoReportData();
  return <PhotoReportWorkspace stores={stores} error={error} initialTab={searchParams.tab} />;
}
