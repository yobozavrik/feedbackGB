import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { getServerSupabase } from "@/lib/supabase";
import { AbsencesWorkspace } from "./absences-workspace";

export default async function NetworkAbsencesPage() {
  const supabase = getServerSupabase();
  const [stores, sellers] = supabase ? await Promise.all([supabase.from("v_stores").select("id, name").eq("is_active", true).order("name"), supabase.from("users").select("id, full_name, store_id").eq("role", "seller").eq("is_active", true).order("full_name")]) : [null, null];
  const error = !supabase ? "Supabase ще не налаштовано" : stores?.error?.message ?? sellers?.error?.message ?? null;
  return (
    <AdminPageContainer
      title="Графік відсутностей"
      subTitle="HR-заявки, відпустки, лікарняні, відгули та переведення продавчинь"
    >
      <AbsencesWorkspace stores={stores?.data ?? []} sellers={sellers?.data ?? []} bootstrapError={error} />
    </AdminPageContainer>
  );
}
