import { getServerSupabase } from "@/lib/supabase";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { AnalyticsClient, type AnalyticsRow } from "./analytics-client";

export const dynamic = "force-dynamic";

const ANALYTICS_WINDOW_DAYS = 90;

async function fetchAnalytics(): Promise<{
  rows: AnalyticsRow[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { rows: [], error: "Supabase ще не налаштовано" };
  }
  const since = new Date(
    Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("feedback_feed")
    .select("created_at,category,category_title,store_name,status")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(10000);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as AnalyticsRow[]) ?? [], error: null };
}

export default async function AnalyticsPage() {
  const { rows, error } = await fetchAnalytics();
  return (
    <AdminPageContainer
      title="Аналітика"
      subTitle={`Розподіл за категоріями, тренди, топ магазинів. Вікно — до ${ANALYTICS_WINDOW_DAYS} днів.`}
    >
      <AnalyticsClient rows={rows} error={error} />
    </AdminPageContainer>
  );
}
