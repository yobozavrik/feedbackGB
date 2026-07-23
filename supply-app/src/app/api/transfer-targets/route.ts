import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSupplyApiUser } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/transfer-targets — pick list for the HR "перевестися" topic.
 * Rows: { kind: 'store'|'facility', id, name }. The client submits
 * target_store_id (int) for a store or target_facility_id (uuid) for a facility.
 */
export async function GET() {
  if (!(await getSupplyApiUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ rows: [] });

  const { data, error } = await supabase
    .from("v_transfer_targets")
    .select("kind, id, name")
    .order("name", { ascending: true });
  if (error) {
    console.error("[supply] transfer-targets", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
