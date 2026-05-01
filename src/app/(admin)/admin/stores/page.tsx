import { getServerSupabase } from "@/lib/supabase";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { StoresClient } from "./stores-client";

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
  feed: StoreFeedRow[];
  sellers: StoreSeller[];
  error: string | null;
}> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return {
      stores: [],
      feed: [],
      sellers: [],
      error: "Supabase ще не налаштовано",
    };
  }

  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [storesRes, feedRes, sellersRes] = await Promise.all([
    supabase
      .from("v_stores")
      .select("id, name, address, lat, lng, is_active")
      .order("id", { ascending: true }),
    supabase
      .from("feedback_feed")
      .select(
        "created_at,store_id,store_name,category,category_emoji,category_title,status,product_id,product_name,summary,user_full_name,user_role",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase
      .from("users")
      .select("id, full_name, store_id, is_active, pin_hash, last_login")
      .order("full_name", { ascending: true }),
  ]);

  if (storesRes.error) {
    return { stores: [], feed: [], sellers: [], error: storesRes.error.message };
  }

  const sellers: StoreSeller[] = (
    (sellersRes.data ?? []) as Array<{
      id: string;
      full_name: string;
      store_id: number | null;
      is_active: boolean;
      pin_hash: string | null;
      last_login: string | null;
    }>
  ).map((u) => ({
    id: u.id,
    full_name: u.full_name,
    store_id: u.store_id,
    is_active: u.is_active,
    has_pin: u.pin_hash != null,
    last_login: u.last_login,
  }));

  return {
    stores: (storesRes.data as StoreRow[]) ?? [],
    feed: (feedRes.data as StoreFeedRow[]) ?? [],
    sellers,
    error: feedRes.error?.message ?? null,
  };
}

export default async function AdminStoresPage() {
  const { stores, feed, sellers, error } = await fetchData();

  return (
    <AdminPageContainer
      title="Магазини"
      subTitle={`Каталог магазинів, активність продавчинь і фідбеку. Вікно — ${WINDOW_DAYS} днів.`}
    >
      <StoresClient
        stores={stores}
        feed={feed}
        sellers={sellers}
        windowDays={WINDOW_DAYS}
        error={error}
      />
    </AdminPageContainer>
  );
}
