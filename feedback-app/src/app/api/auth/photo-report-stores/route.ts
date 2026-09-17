import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stores a seller may select for a photo report. This is not shift attendance. */
export async function GET() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (session.role !== "seller") return NextResponse.json({ stores: [] });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "db_error" }, { status: 503 });

  const [{ data: user, error: userError }, { data: permissions, error: permissionError }, { data: stores, error: storeError }] = await Promise.all([
    supabase.from("users").select("id, store_id, role, is_active").eq("id", session.uid).maybeSingle(),
    supabase.from("seller_store_permissions").select("store_id").eq("seller_id", session.uid).is("revoked_at", null),
    supabase.from("v_stores").select("id, name"),
  ]);
  if (userError || permissionError || storeError || !user || !user.is_active || user.role !== "seller") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const replacementIds = new Set((permissions ?? []).map((row) => row.store_id as number));
  const allowedIds = new Set<number>(replacementIds);
  if (user.store_id != null) allowedIds.add(user.store_id as number);

  return NextResponse.json({
    stores: (stores ?? [])
      .filter((store) => allowedIds.has(store.id as number))
      .map((store) => ({
        id: store.id as number,
        name: store.name as string,
        source: store.id === user.store_id ? "home_store" : "replacement_permission",
      })),
  });
}
