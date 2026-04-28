import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const tok = cookies().get(SESSION_COOKIE)?.value;
  const sess = await verifySession(tok);
  if (!sess) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({
    user: {
      full_name: sess.full_name,
      role: sess.role,
      store_id: sess.store_id,
    },
  });
}
