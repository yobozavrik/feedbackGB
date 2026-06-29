import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";

/**
 * Gate every page except auth/api/static behind a PIN.
 * Anonymous visitors get redirected to /login.
 * Non-admins trying to hit /admin get bounced back to /.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icons/")
  ) {
    // /api/cron/* protects itself via CRON_SECRET; we bypass session here so
    // Vercel Cron's authenticated calls aren't rejected as anonymous.
    return NextResponse.next();
  }

  const tok = req.cookies.get(SESSION_COOKIE)?.value;
  const sess = await verifySession(tok);

  if (!sess) {
    // API calls without a session get JSON 401 instead of an HTML redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Admin-only surfaces.
  const isAdminRoute =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    (pathname.startsWith("/api/feedback") && req.method !== "POST");
  if (isAdminRoute && !isAdminTier(sess.role)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
