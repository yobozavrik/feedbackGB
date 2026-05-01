import { getServerSupabase } from "@/lib/supabase";
import { AuditClient } from "./audit-client";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";

export const dynamic = "force-dynamic";

export interface AuditRow {
  id: number;
  occurred_at: string;
  action: string;
  section: string;
  action_title: string;
  actor_user_id: string | null;
  actor_full_name: string | null;
  actor_role: "seller" | "admin" | null;
  target_user_id: string | null;
  target_full_name: string | null;
  target_type: string | null;
  feedback_id: string | null;
  ip: string | null;
  user_agent: string | null;
  meta: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
}

async function fetchRows(): Promise<{ rows: AuditRow[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { rows: [], error: "Supabase ще не налаштовано" };
  }
  const { data, error } = await supabase
    .from("v_audit_log")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as AuditRow[]) ?? [], error: null };
}

export default async function AdminAuditPage() {
  const { rows, error } = await fetchRows();
  return (
    <AdminPageContainer
      title="Журнал дій"
      subTitle="Останні 500 подій авторизації, фідбеку та адмін-дій"
    >
      {error ? (
        <div className="card p-6 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="mt-3 text-[14px] text-ink-700">{error}</p>
        </div>
      ) : (
        <AuditClient rows={rows} />
      )}
    </AdminPageContainer>
  );
}
