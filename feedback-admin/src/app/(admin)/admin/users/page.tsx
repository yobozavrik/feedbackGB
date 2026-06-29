import { getServerSupabase } from "@/lib/supabase";
import { UsersClient } from "./users-client";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";

export const dynamic = "force-dynamic";

export interface AdminUser {
  id: string;
  full_name: string;
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

async function fetchData(): Promise<{
  users: AdminUser[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { users: [], error: "Supabase ще не налаштовано" };
  }

  const [{ data: userRows, error: userErr }, { data: storeRows }] =
    await Promise.all([
      supabase
        .from("users")
        .select(
          "id, full_name, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login, last_login_country, last_login_city, last_login_asn, last_login_isp",
        )
        .order("full_name", { ascending: true }),
      supabase.from("v_stores").select("id, name"),
    ]);

  if (userErr) return { users: [], error: userErr.message };

  const storeMap = new Map<number, string>();
  for (const s of (storeRows ?? []) as Array<{ id: number; name: string }>) {
    storeMap.set(s.id, s.name);
  }

  const rows = (userRows ?? []) as Array<{
    id: string;
    full_name: string;
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

  const users: AdminUser[] = rows.map((u) => ({
    id: u.id,
    full_name: u.full_name,
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

  return { users, error: null };
}

export default async function AdminUsersPage() {
  const { users, error } = await fetchData();

  return (
    <AdminPageContainer
      title="Користувачі"
      subTitle="PIN-коди, розблокування, активність"
    >
      {error ? (
        <div className="card p-6 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="mt-3 text-[14px] text-ink-700">{error}</p>
        </div>
      ) : (
        <UsersClient users={users} />
      )}
    </AdminPageContainer>
  );
}
