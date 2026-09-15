import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { logAudit, ipFromRequest, uaFromRequest } from "@/lib/audit";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/\b\d{6,}\b/g, "[redacted-number]")
    .replace(/bearer\s+[\w.-]+/gi, "Bearer [redacted]")
    .slice(0, max);
}

/** Records browser crashes in audit_log. No form content, cookies, or PINs are accepted. */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  try {
    const limit = await rateLimit(`telemetry:client-error:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.ok) return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "telemetry.rate_limit.failed", surface: "seller_app", error: error instanceof Error ? error.message : String(error) }));
    return new NextResponse(null, { status: 204 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  await logAudit("client.error", {
    actorUserId: session?.uid ?? null,
    targetType: "client_error",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: {
      app_surface: "web_app",
      request_id: req.headers.get("x-request-id"),
      kind: clean(body.kind, 40),
      route: clean(body.route, 300),
      message: clean(body.message, 500),
      stack: clean(body.stack, 2_000),
    },
  });
  return new NextResponse(null, { status: 204 });
}
