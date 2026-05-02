import { cookies } from "next/headers";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/categories";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { AdminClient } from "./admin-client";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { DashboardKPI, type DashboardRow } from "@/components/admin/DashboardKPI";
import { DashboardHeatmap } from "@/components/admin/DashboardHeatmap";

export const dynamic = "force-dynamic";

const DASHBOARD_WINDOW_DAYS = 30;

export interface FeedRow {
  id: string;
  created_at: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  store_id: number | null;
  store_name: string | null;
  fields: Record<string, unknown> | null;
  photo_url: string | null;
  user_id: string | null;
  user_full_name: string | null;
  user_role: string | null;
  tg_username: string | null;
  tg_display_name: string | null;
  tg_verified: boolean;
  summary: string;
  status: string;
  assigned_to: string | null;
  assigned_full_name: string | null;
}

export interface AdminOption {
  id: string;
  full_name: string;
}

const SIGNED_URL_TTL = 60 * 10; // 10 minutes

async function fetchRows(): Promise<{ rows: FeedRow[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { rows: [], error: "Supabase ще не налаштовано" };
  }
  const { data, error } = await supabase
    .from("feedback_feed")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { rows: [], error: error.message };
  const rows = (data as FeedRow[]) ?? [];

  // Resolve "sb:<path>" references to short-lived signed URLs. Anything else
  // is dropped (we no longer trust arbitrary http/https/data URLs in the DB).
  await Promise.all(
    rows.map(async (r) => {
      r.photo_url = await resolvePhotoUrl(supabase, r.photo_url);
    }),
  );

  return { rows, error: null };
}

async function fetchDashboardStats(): Promise<DashboardRow[]> {
  const supabase = getServerSupabase();
  if (!supabase) return [];
  const since = new Date(
    Date.now() - DASHBOARD_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("feedback_feed")
    .select("created_at,category,category_title,store_name,status")
    .gte("created_at", since)
    .limit(5000);
  if (error) return [];
  return (data as DashboardRow[]) ?? [];
}

async function resolvePhotoUrl(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  raw: string | null,
): Promise<string | null> {
  if (!raw) return null;
  if (raw.startsWith("sb:")) {
    const path = raw.slice(3);
    const { data } = await supabase.storage
      .from("feedback-photos")
      .createSignedUrl(path, SIGNED_URL_TTL);
    return data?.signedUrl ?? null;
  }
  // Legacy records: only accept same-project Supabase storage URLs.
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (
    projectUrl &&
    raw.startsWith(`${projectUrl}/storage/v1/object/public/feedback-photos/`)
  ) {
    return raw;
  }
  return null;
}

async function fetchAdmins(): Promise<AdminOption[]> {
  const supabase = getServerSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("role", "admin")
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  if (error) return [];
  return (data as AdminOption[]) ?? [];
}

export default async function AdminPage() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  const currentAdminId = sess?.uid ?? null;

  const [{ rows, error }, statsRows, admins] = await Promise.all([
    fetchRows(),
    fetchDashboardStats(),
    fetchAdmins(),
  ]);
  const stores = Array.from(
    new Set(rows.map((r) => r.store_name).filter((x): x is string => Boolean(x))),
  ).sort();

  return (
    <AdminPageContainer
      title="Огляд"
      subTitle="Стрічка фідбеку та швидкі дії адміністратора"
    >
      {!isSupabaseConfigured() ? (
        <div className="card mb-4 p-5 text-[14px] leading-relaxed text-ink-700">
          <p className="font-medium text-ink-900">Supabase не підключено</p>
          <p className="mt-1">
            Додай у <code>.env</code>{" "}
            <code className="rounded bg-elev2 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            та{" "}
            <code className="rounded bg-elev2 px-1">SUPABASE_SERVICE_ROLE_KEY</code>,
            потім застосуй <code>supabase/schema.sql</code>.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 text-[14px] text-brand-600">
          Помилка: {error}
        </div>
      ) : null}

      <DashboardKPI rows={statsRows} />
      <DashboardHeatmap rows={statsRows} days={14} />

      <AdminClient
        rows={rows}
        stores={stores}
        admins={admins}
        currentAdminId={currentAdminId}
        categories={CATEGORIES.map((c) => ({
          id: c.id,
          title: c.title,
          emoji: c.emoji,
          tint: c.tint,
        }))}
      />
    </AdminPageContainer>
  );
}
