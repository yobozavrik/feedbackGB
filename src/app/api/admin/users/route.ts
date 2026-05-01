import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AdminUserRow {
  id: string;
  full_name: string;
  role: "seller" | "admin";
  store_id: number | null;
  is_active: boolean;
  has_pin: boolean;
  failed_attempts: number;
  locked_until: string | null;
  last_login: string | null;
}

/**
 * GET /api/admin/users
 * Admin-only. Returns the full user list with status fields useful for
 * managing PINs (lockout state, whether a PIN is currently set, last login).
 * Middleware already enforces role===admin for /api/admin/* — we re-check
 * here as defence in depth.
 */
export async function GET() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || sess.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ users: [] });
  }

  const { data, error } = await supabase
    .from("users")
    .select(
      "id, full_name, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login",
    )
    .order("full_name", { ascending: true });

  if (error) {
    console.error("admin list users error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    full_name: string;
    role: "seller" | "admin";
    store_id: number | null;
    is_active: boolean;
    pin_hash: string | null;
    failed_attempts: number | null;
    locked_until: string | null;
    last_login: string | null;
  }>;

  const users: AdminUserRow[] = rows.map((u) => ({
    id: u.id,
    full_name: u.full_name,
    role: u.role,
    store_id: u.store_id,
    is_active: u.is_active,
    has_pin: u.pin_hash != null,
    failed_attempts: u.failed_attempts ?? 0,
    locked_until: u.locked_until,
    last_login: u.last_login,
  }));

  return NextResponse.json({ users });
}
