import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";
import { buildDailyPhotoReport, kyivDay, type PhotoReportEntry, type PhotoReportStore } from "@/lib/photoReport";

export const runtime = "nodejs";

const MAX_DAILY_REPORTS = 2_000;

function isDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

/** Returns one operational Kyiv day, keeping aggregation and raw report data on the server. */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const date = new URL(req.url).searchParams.get("date");
  if (!isDate(date)) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });

  // The database timestamps are UTC. Fetch only the small window which can
  // contain this Kyiv calendar day, then apply the timezone rule exactly.
  const from = new Date(`${date}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const until = new Date(`${date}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 2);
  const [storesRes, reportsRes] = await Promise.all([
    supabase.from("v_stores").select("id, name, is_active").eq("is_active", true).order("name", { ascending: true }),
    supabase
      .from("feedback_feed")
      .select("created_at,store_id,store_name,user_full_name,photo_url,photo_urls")
      .eq("category", "photo_report")
      .gte("created_at", from.toISOString())
      .lt("created_at", until.toISOString())
      .order("created_at", { ascending: false })
      .limit(MAX_DAILY_REPORTS),
  ]);
  if (storesRes.error || reportsRes.error) {
    console.error(JSON.stringify({ level: "error", event: "photo_report.daily.query_failed", stores_code: storesRes.error?.code, reports_code: reportsRes.error?.code, date, actor_user_id: session.uid }));
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const entries = ((reportsRes.data ?? []) as PhotoReportEntry[]).filter((entry) => kyivDay(entry.created_at) === date);
  const rows = buildDailyPhotoReport((storesRes.data ?? []) as PhotoReportStore[], entries, date);
  console.log(JSON.stringify({ level: "info", event: "photo_report.daily.opened", date, stores: rows.length, reports: entries.length, actor_user_id: session.uid, request_id: req.headers.get("x-request-id") }));
  return NextResponse.json({ rows });
}
