import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LooseClient = SupabaseClient<any, any, any>;

export function getServerSupabase(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false }, db: { schema: "feedbackgb" } }) as LooseClient;
}
