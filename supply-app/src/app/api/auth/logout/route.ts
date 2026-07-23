import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { writeLoginAudit } from "@/lib/audit";
import { SUPPLY_SESSION_COOKIE, verifySupplySession } from "@/lib/session";

export const runtime = "nodejs";

function clearSession(response: NextResponse) {
  response.cookies.set(SUPPLY_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

/** Records auth.logout for a valid session. Never blocks the logout itself. */
async function auditLogout(request: Request) {
  try {
    const session = await verifySupplySession(cookies().get(SUPPLY_SESSION_COOKIE)?.value);
    if (session?.uid) await writeLoginAudit("auth.logout", request, session.uid);
  } catch (error) {
    console.error("[supply-auth] logout audit skipped", error);
  }
}

export async function POST(request: Request) {
  await auditLogout(request);
  if (request.headers.get("accept")?.includes("text/html")) {
    return clearSession(NextResponse.redirect(new URL("/", request.url), { status: 303 }));
  }
  return clearSession(NextResponse.json({ ok: true }));
}

export async function GET(request: Request) {
  await auditLogout(request);
  const next = new URL(request.url).searchParams.get("next");
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return clearSession(NextResponse.redirect(new URL(target, request.url), { status: 303 }));
}
