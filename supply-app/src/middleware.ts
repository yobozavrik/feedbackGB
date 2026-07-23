import { NextResponse, type NextRequest } from "next/server";
import { SUPPLY_SESSION_COOKIE, verifySupplySession } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icons/")
  ) {
    return NextResponse.next();
  }

  const session = await verifySupplySession(request.cookies.get(SUPPLY_SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("next", pathname);
  const response = NextResponse.redirect(url);
  response.cookies.set(SUPPLY_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
