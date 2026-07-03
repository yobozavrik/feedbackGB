import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/categories";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { TasksClient } from "./tasks-client";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import type { FeedRow, AdminOption } from "../page";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 60 * 10; // 10 minutes

async function fetchMyRows(currentAdminId: string): Promise<{ rows: FeedRow[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { rows: [], error: "Supabase ще не налаштовано" };
  }
  const { data, error } = await supabase
    .from("feedback_feed")
    .select("*")
    .eq("assigned_to", currentAdminId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return { rows: [], error: error.message };
  const rows = (data as FeedRow[]) ?? [];

  await Promise.all(
    rows.map(async (r) => {
      r.photo_url = await resolvePhotoUrl(supabase, r.photo_url);
    }),
  );

  return { rows, error: null };
}

/**
 * Unassigned feedback that falls within one of the current admin's active
 * directions — i.e. a "shared queue" item (2+ admins cover that category/
 * store, so resolveAssignedAdmin left it unassigned at creation time; see
 * feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md). Whoever opens it and picks
 * themself in the FeedDrawer "Відповідальний" control claims it — after
 * that it moves into fetchMyRows() above for everyone else.
 */
async function fetchAvailableRows(currentAdminId: string): Promise<{ rows: FeedRow[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { rows: [], error: "Supabase ще не налаштовано" };
  }

  const [{ data: directionRows, error: directionErr }, { data: feedbackRows, error: feedbackErr }] =
    await Promise.all([
      supabase
        .from("admin_directions")
        .select("category, store_id")
        .eq("admin_id", currentAdminId)
        .eq("is_active", true),
      supabase
        .from("feedback_feed")
        .select("*")
        .is("assigned_to", null)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  if (directionErr) return { rows: [], error: directionErr.message };
  if (feedbackErr) return { rows: [], error: feedbackErr.message };

  const directions = (directionRows ?? []) as Array<{ category: string; store_id: number | null }>;
  if (directions.length === 0) return { rows: [], error: null };

  const allStoresCategories = new Set(
    directions.filter((d) => d.store_id == null).map((d) => d.category),
  );
  const exactScope = new Set(
    directions.filter((d) => d.store_id != null).map((d) => `${d.category}:${d.store_id}`),
  );

  const rows = ((feedbackRows as FeedRow[] | null) ?? []).filter((r) => {
    if (allStoresCategories.has(r.category)) return true;
    if (r.store_id != null && exactScope.has(`${r.category}:${r.store_id}`)) return true;
    return false;
  });

  await Promise.all(
    rows.map(async (r) => {
      r.photo_url = await resolvePhotoUrl(supabase, r.photo_url);
    }),
  );

  return { rows, error: null };
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
    .in("role", ["admin", "super_admin"])
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  if (error) return [];
  return (data as AdminOption[]) ?? [];
}

export default async function AdminTasksPage() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || (sess.role !== "admin" && sess.role !== "super_admin")) {
    redirect("/login");
  }
  const currentAdminId = sess.uid;

  const [{ rows: myRows, error: myError }, { rows: availableRows, error: availableError }, admins] =
    await Promise.all([
      fetchMyRows(currentAdminId),
      fetchAvailableRows(currentAdminId),
      fetchAdmins(),
    ]);

  const error = myError ?? availableError;

  const stores = Array.from(
    new Set(
      [...myRows, ...availableRows]
        .map((r) => r.store_name)
        .filter((x): x is string => Boolean(x)),
    ),
  ).sort();

  return (
    <AdminPageContainer
      title="Мої завдання"
      subTitle="Звернення продавчинь, які призначені мені або доступні в моїх напрямках"
    >
      {!isSupabaseConfigured() ? (
        <div className="card mb-4 p-5 text-[14px] leading-relaxed text-ink-700">
          <p className="font-medium text-ink-900">Supabase не підключено</p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 text-[14px] text-brand-600">
          Помилка: {error}
        </div>
      ) : null}

      <TasksClient
        myRows={myRows}
        availableRows={availableRows}
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
