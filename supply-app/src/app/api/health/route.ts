import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { isSupplySchemaReady } from "@/lib/supplySchema";
import { getSessionSecret } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — unauthenticated liveness + readiness probe.
 * Reports whether the Supply migration is applied and whether the session
 * secret is configured. Never returns secrets or DB error detail.
 */
export async function GET() {
  const supabase = getServerSupabase();

  let sessionSecretOk = false;
  try {
    getSessionSecret();
    sessionSecretOk = true;
  } catch {
    sessionSecretOk = false;
  }

  const schemaReady = supabase ? await isSupplySchemaReady(supabase) : false;

  return NextResponse.json({
    ok: true,
    supabase_configured: Boolean(supabase),
    schema_ready: schemaReady,
    session_secret_ok: sessionSecretOk,
  });
}
