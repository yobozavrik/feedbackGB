import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** All app objects live in this Postgres schema. */
export const FEEDBACK_SCHEMA = "feedbackgb";

/**
 * Loose client type. We don't yet generate Database types from Supabase, and
 * the schema generic on SupabaseClient gets in the way (it defaults to
 * "public" but at runtime we route everything through `feedbackgb`). Until we
 * add codegen, treat the client as untyped at the schema level.
 */
// eslint config doesn't ship the @typescript-eslint plugin, so plain `any`
// is fine here and we don't need a disable comment.
type LooseClient = SupabaseClient<any, any, any>;

/**
 * Server-side Supabase client (uses service role when available so we can
 * insert feedback regardless of RLS). Falls back to anon key if service role
 * is missing — in that case make sure RLS policies permit inserts.
 *
 * Returns null when env is not configured so the API can degrade gracefully
 * during local dev.
 *
 * The client is scoped to the `feedbackgb` schema so all `.from()` calls hit
 * our isolated tables/views and not anything in `public`.
 */
export function getServerSupabase(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: FEEDBACK_SCHEMA },
  }) as unknown as LooseClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

/**
 * Client-side Supabase client (uses anon key).
 */
export function getClientSupabase(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    db: { schema: FEEDBACK_SCHEMA },
  }) as unknown as LooseClient;
}
