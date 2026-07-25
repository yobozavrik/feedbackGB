import { getZakupkiSupabase } from "@/lib/zakupkiDb";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SupplyClient, type SupplyOrderRow } from "./supply-client";

export const dynamic = "force-dynamic";

interface RequestRow {
  id: string;
  status: string;
  comment: string | null;
  created_at: string;
  workshops: { name_uk: string; code: string } | null;
  employees: { first_name: string; last_name: string } | null;
  request_items: { item_name: string; quantity: number; unit: string }[] | null;
}

async function fetchOrders(): Promise<{ rows: SupplyOrderRow[]; error: string | null }> {
  const zakupki = getZakupkiSupabase();
  if (!zakupki) return { rows: [], error: "zakupki ще не налаштовано" };

  const { data, error } = await zakupki
    .from("requests")
    .select(
      "id, status, comment, created_at, workshops(name_uk, code), employees(first_name, last_name), request_items(item_name, quantity, unit)",
    )
    .eq("type", "raw_material")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { rows: [], error: error.message };

  const rows: SupplyOrderRow[] = ((data ?? []) as unknown as RequestRow[]).map((r) => ({
    id: r.id,
    status: r.status,
    comment: r.comment,
    createdAt: r.created_at,
    workshopName: r.workshops?.name_uk ?? "—",
    workshopCode: r.workshops?.code ?? "",
    employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}`.trim() : "—",
    items: (r.request_items ?? []).map((i) => ({ name: i.item_name, quantity: i.quantity, unit: i.unit })),
  }));
  return { rows, error: null };
}

export default async function SupplyAdminPage() {
  const { rows, error } = await fetchOrders();

  return (
    <AdminPageContainer title="Постачання" subTitle="Заявки з Supply App для цехів і складів">
      <SupplyClient orders={rows} loadError={error} />
    </AdminPageContainer>
  );
}
