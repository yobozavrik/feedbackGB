import type { SupabaseClient } from "@supabase/supabase-js";

let schemaReadyPromise: Promise<boolean> | null = null;

export function isSupplySchemaReady(supabase: SupabaseClient<any, any, any>): Promise<boolean> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = Promise.resolve(
      supabase.from("facilities").select("id", { head: true, count: "exact" }),
    ).then(({ error }) => !error, () => false);
  }
  return schemaReadyPromise;
}
