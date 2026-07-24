import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LooseClient = SupabaseClient<any, any, any>;

/** Server-only client for the shared raw-materials procurement schema. */
export function getZakupkiSupabase(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: "zakupki" },
  }) as unknown as LooseClient;
}
