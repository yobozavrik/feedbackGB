import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LooseClient = SupabaseClient<any, any, any>;

/** Server-only client for the shared raw-materials procurement schema (see
 * supply-app/src/lib/zakupkiDb.ts — same schema, same env vars, separate
 * client instance per app). */
export function getZakupkiSupabase(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: "zakupki" },
  }) as unknown as LooseClient;
}
