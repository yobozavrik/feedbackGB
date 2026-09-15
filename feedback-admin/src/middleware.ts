import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";

const SURFACE = "feedbackgb";

function requestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? req.headers.get("x-vercel-id") ?? crypto.randomUUID();
}

function logRequest(event: "http.request.start" | "http.request.decision", req: NextRequest, id: string, decision?: string) {
  // Do not log query parameters, bodies, cookies, PINs, or authorization headers.
  console.log(JSON.stringify({
    level: "info",
    event,
    surface: SURFACE,
    request_id: id,
    method: req.method,
    path: req.nextUrl.pathname,
    ...(decision ? { decision } : {}),
  }));
}

function continueWithRequestId(req: NextRequest, id: string): NextResponse {
  const headers = new Headers(req.headers);
  headers.set("x-request-id", id);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", id);
  return res;
}

/**
 * Gate every page except auth/api/static behind a PIN.
 * Anonymous visitors get redirected to /login.
 * Non-admins trying to hit /admin get bounced back to /.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const id = requestId(req);
  logRequest("http.request.start", req, id);

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/telemetry/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icons/")
  ) {
    // /api/cron/* protects itself via CRON_SECRET; we bypass session here so
    // Vercel Cron's authenticated calls aren't rejected as anonymous.
    logRequest("http.request.decision", req, id, "bypass_auth");
    return continueWithRequestId(req, id);
  }

  const tok = req.cookies.get(SESSION_COOKIE)?.value;
  const sess = await verifySession(tok);

  if (!sess) {
    // API calls without a session get JSON 401 instead of an HTML redirect.
    if (pathname.startsWith("/api/")) {
      logRequest("http.request.decision", req, id, "unauthenticated");
      return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: { "x-request-id": id } });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    logRequest("http.request.decision", req, id, "redirect_login");
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", id);
    return res;
  }

  // Admin-only surfaces.
  const isAdminRoute =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    (pathname.startsWith("/api/feedback") && req.method !== "POST");
  if (isAdminRoute && !isAdminTier(sess.role)) {
    if (pathname.startsWith("/api/")) {
      logRequest("http.request.decision", req, id, "forbidden");
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "x-request-id": id } });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    logRequest("http.request.decision", req, id, "redirect_forbidden");
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", id);
    return res;
  }

  logRequest("http.request.decision", req, id, "allow");
  return continueWithRequestId(req, id);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
