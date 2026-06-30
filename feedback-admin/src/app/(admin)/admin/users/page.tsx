import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { UsersClient } from "./users-client";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export interface AdminUser {
  id: string;
  full_name: string;
  display_label: string | null;
  role: "seller" | "admin" | "super_admin";
  store_id: number | null;
  store_name: string | null;
  is_active: boolean;
  has_pin: boolean;
  failed_attempts: number;
  locked_until: string | null;
  last_login: string | null;
  last_login_country: string | null;
  last_login_city: string | null;
  last_login_asn: string | null;
  last_login_isp: string | null;
}

export interface FeedbacksStat {
  id: string;
  user_id: string | null;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  store_name: string | null;
  summary: string;
  status: string;
  created_at: string;
}

async function fetchData(): Promise<{
  users: AdminUser[];
  stores: Array<{ id: number; name: string }>;
  feedbacks: FeedbacksStat[];
  currentUserId: string;
  currentUserRole: "admin" | "super_admin";
  error: string | null;
}> {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || (sess.role !== "admin" && sess.role !== "super_admin")) {
    return { users: [], stores: [], feedbacks: [], currentUserId: "", currentUserRole: "admin", error: "Недостатньо прав" };
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return { users: [], stores: [], feedbacks: [], currentUserId: sess.uid, currentUserRole: sess.role, error: "Supabase ще не налаштовано" };
  }

  const [{ data: userRows, error: userErr }, { data: storeRows }, { data: feedbackRows }] =
    await Promise.all([
      supabase
        .from("users")
        .select(
          "id, full_name, display_label, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login, last_login_country, last_login_city, last_login_asn, last_login_isp",
        )
        .order("full_name", { ascending: true }),
      supabase.from("v_stores").select("id, name"),
      supabase.from("feedback_feed").select("id, user_id, category, category_emoji, category_title, store_name, summary, status, created_at"),
    ]);

  if (userErr) return { users: [], stores: [], feedbacks: [], currentUserId: sess.uid, currentUserRole: sess.role, error: userErr.message };

  const stores = (storeRows ?? []) as Array<{ id: number; name: string }>;
  const storeMap = new Map<number, string>();
  for (const s of stores) {
    storeMap.set(s.id, s.name);
  }

  const feedbacks = (feedbackRows ?? []) as FeedbacksStat[];

  const rawRows = (userRows ?? []) as Array<{
    id: string;
    full_name: string;
    display_label: string | null;
    role: "seller" | "admin" | "super_admin";
    store_id: number | null;
    is_active: boolean;
    pin_hash: string | null;
    failed_attempts: number | null;
    locked_until: string | null;
    last_login: string | null;
    last_login_country: string | null;
    last_login_city: string | null;
    last_login_asn: string | null;
    last_login_isp: string | null;
  }>;

  const rows = sess.role === "admin" ? rawRows.filter((r) => r.role !== "super_admin") : rawRows;

  const users: AdminUser[] = rows.map((u) => ({
    id: u.id,
    full_name: u.full_name,
    display_label: u.display_label,
    role: u.role,
    store_id: u.store_id,
    store_name: u.store_id != null ? storeMap.get(u.store_id) ?? null : null,
    is_active: u.is_active,
    has_pin: u.pin_hash != null,
    failed_attempts: u.failed_attempts ?? 0,
    locked_until: u.locked_until,
    last_login: u.last_login,
    last_login_country: u.last_login_country,
    last_login_city: u.last_login_city,
    last_login_asn: u.last_login_asn,
    last_login_isp: u.last_login_isp,
  }));

  return { users, stores, feedbacks, currentUserId: sess.uid, currentUserRole: sess.role, error: null };
}

export default async function AdminUsersPage() {
  const { users, stores, feedbacks, currentUserId, currentUserRole, error } = await fetchData();

  return (
    <AdminPageContainer
      title="Співробітники"
      subTitle="Управління продавцями, PIN-коди, статистика активності"
    >
      {error ? (
        <div className="card p-6 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="mt-3 text-[14px] text-ink-700">{error}</p>
        </div>
      ) : (
        <UsersClient
          users={users}
          stores={stores}
          feedbacks={feedbacks}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      )}
    </AdminPageContainer>
  );
}
