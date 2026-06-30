import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (sess?.uid) {
    await logAudit("auth.logout", {
      actorUserId: sess.uid,
      targetType: "session",
      ip: ipFromRequest(req),
      userAgent: uaFromRequest(req),
      meta: { app_surface: "admin_panel" },
    });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
