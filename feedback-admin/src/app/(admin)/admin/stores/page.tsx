import { getServerSupabase } from "@/lib/supabase";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { StoresTabs } from "./stores-tabs";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;

export interface StoreRow {
  id: number;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
}

export interface StoreFeedRow {
  created_at: string;
  store_id: number | null;
  store_name: string | null;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  status: string;
  product_id: number | null;
  product_name: string | null;
  summary: string | null;
  user_full_name: string | null;
  user_role: string | null;
}

export interface StoreSeller {
  id: string;
  full_name: string;
  store_id: number | null;
  is_active: boolean;
  has_pin: boolean;
  last_login: string | null;
}

async function fetchData(): Promise<{
  stores: StoreRow[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return {
      stores: [],
      error: "Supabase ще не налаштовано",
    };
  }

  const storesRes = await supabase
    .from("v_stores")
    .select("id, name, address, lat, lng, is_active")
    .order("id", { ascending: true });

  if (storesRes.error) {
    return { stores: [], error: storesRes.error.message };
  }

  return {
    stores: (storesRes.data as StoreRow[]) ?? [],
    error: null,
  };
}

export default async function AdminStoresPage() {
  const { stores, error } = await fetchData();

  return (
    <AdminPageContainer
      title="Магазини"
      subTitle={`Каталог магазинів, активність продавчинь і фідбеку. Вікно — ${WINDOW_DAYS} днів.`}
    >
      <StoresTabs
        stores={stores}
        windowDays={WINDOW_DAYS}
        error={error}
      />
    </AdminPageContainer>
  );
}
