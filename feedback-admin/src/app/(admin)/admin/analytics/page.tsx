import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { AnalyticsClient } from "./analytics-client";

export const dynamic = "force-dynamic";

export interface AnalyticsUserOpt {
  id: string;
  full_name: string;
  display_label: string | null;
}

async function fetchData(): Promise<{
  users: AnalyticsUserOpt[];
  isSuper: boolean;
  error: string | null;
}> {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) {
    return { users: [], isSuper: false, error: "Необхідно увійти в систему" };
  }

  if (sess.role !== "super_admin") {
    return { users: [], isSuper: false, error: null }; // Forbidden but not db_error
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return { users: [], isSuper: true, error: "Supabase не налаштовано" };
  }

  const { data: userRows, error: userErr } = await supabase
    .from("users")
    .select("id, full_name, display_label")
    .order("full_name", { ascending: true });

  if (userErr) {
    return { users: [], isSuper: true, error: userErr.message };
  }

  const users = (userRows ?? []) as AnalyticsUserOpt[];

  return { users, isSuper: true, error: null };
}

export default async function AdminAnalyticsPage() {
  const { users, isSuper, error } = await fetchData();

  return (
    <AdminPageContainer
      title="Теплові карти & Аналітика кліків"
      subTitle="Аналіз взаємодій продавчинь з інтерфейсом Mini App"
    >
      {!isSuper ? (
        <div className="card p-6 text-center">
          <div className="text-3xl">🔒</div>
          <h2 className="mt-3 text-lg font-bold text-ink-900">Доступ обмежено</h2>
          <p className="mt-2 text-[14px] text-ink-500 max-w-md mx-auto">
            Цей розділ містить персональну аналітику активності та доступний виключно для ролі <strong>Супер-адмін</strong>.
          </p>
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="mt-3 text-[14px] text-ink-700">{error}</p>
        </div>
      ) : (
        <AnalyticsClient users={users} />
      )}
    </AdminPageContainer>
  );
}
