import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { buildFunnelSnapshot, isPeriodDays } from "@/lib/posthog/funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/funnel?period=7|30|90
 *
 * Admin-only. Returns the {@link FunnelResponse} JSON snapshot used by
 * `/admin/funnel`. Snapshot composition lives in `lib/posthog/funnel.ts`.
 *
 * Cache: handler itself runs `force-dynamic` (per-request) but PostHog
 * funnel results are slow-changing — the page component is also marked
 * `revalidate=300`, so client-driven re-renders within 5 min reuse
 * upstream data.
 */
export async function GET(req: Request) {
  const sess = await requireAdminSession("super_admin");
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const periodRaw = Number(url.searchParams.get("period") ?? "30");
  const period = isPeriodDays(periodRaw) ? periodRaw : 30;
  const snapshot = await buildFunnelSnapshot(period);
  return NextResponse.json(snapshot);
}
