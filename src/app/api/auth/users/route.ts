import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 60;

/**
 * GET /api/auth/users
 * Returns the minimal list of active users for the login picker.
 * PIN never leaves the server; only (id, full_name, role) are exposed so
 * the client can render a selector before asking for a PIN.
 */
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ users: [] });
  }
  const { data, error } = await supabase
    .from("v_login_users")
    .select("id, full_name, role");
  if (error) {
    console.error("list login users error", { code: error.code });
    return NextResponse.json({ users: [], error: "db_error" }, { status: 500 });
  }
  return NextResponse.json({ users: data ?? [] });
}
