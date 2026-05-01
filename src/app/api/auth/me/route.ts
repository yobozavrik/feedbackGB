import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const tok = cookies().get(SESSION_COOKIE)?.value;
  const sess = await verifySession(tok);
  if (!sess) {
    return NextResponse.json({ user: null });
  }

  // Resolve seller's locked store name (from ERP via v_stores) so the form
  // can render the chip without an extra round-trip.
  let store: { id: number; name: string } | null = null;
  if (sess.store_id != null) {
    const sb = getServerSupabase();
    if (sb) {
      const { data } = await sb
        .from("v_stores")
        .select("id,name")
        .eq("id", sess.store_id)
        .maybeSingle();
      if (data && typeof data.name === "string") {
        store = { id: Number(data.id), name: data.name };
      }
    }
  }

  return NextResponse.json({
    user: {
      uid: sess.uid,
      full_name: sess.full_name,
      role: sess.role,
      store_id: sess.store_id,
    },
    store,
  });
}
