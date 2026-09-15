import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { kyivDay, reportPhotoUrls, type PhotoReportEntry } from "@/lib/photoReport";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 10 * 60;
const MAX_REPORTS = 100;

type GalleryEntry = PhotoReportEntry & { id: string };

function isDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isLegacyPublicUrl(raw: string): boolean {
  return raw.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/`);
}

/** Returns temporary admin-only URLs for the selected store's reports on one Kyiv day. */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const storeId = Number(searchParams.get("store_id"));
  const date = searchParams.get("date");
  if (!Number.isInteger(storeId) || storeId <= 0 || !isDate(date)) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });

  // Query a wider UTC window, then decide the operational day strictly in Kyiv.
  const from = new Date(`${date}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const until = new Date(`${date}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 2);
  const { data, error } = await supabase
    .from("feedback_feed")
    .select("id,created_at,store_id,store_name,user_full_name,photo_url,photo_urls")
    .eq("category", "photo_report")
    .eq("store_id", storeId)
    .gte("created_at", from.toISOString())
    .lt("created_at", until.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_REPORTS);
  if (error) {
    console.error(JSON.stringify({ level: "error", event: "photo_report.gallery.query_failed", code: error.code, store_id: storeId, date }));
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const entries = ((data ?? []) as GalleryEntry[]).filter((entry) => kyivDay(entry.created_at) === date);
  const storagePaths = [...new Set(entries.flatMap(reportPhotoUrls).filter((url) => url.startsWith("sb:")).map((url) => url.slice(3)))];
  const { data: signed, error: signingError } = storagePaths.length
    ? await supabase.storage.from("feedback-photos").createSignedUrls(storagePaths, SIGNED_URL_TTL_SECONDS)
    : { data: [], error: null };
  if (signingError) {
    console.error(JSON.stringify({ level: "error", event: "photo_report.gallery.signing_failed", store_id: storeId, date, paths: storagePaths.length }));
    return NextResponse.json({ error: "signing_failed" }, { status: 500 });
  }
  const signedByPath = new Map((signed ?? []).flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
  const reports = entries.map((entry) => ({
    id: entry.id,
    created_at: entry.created_at,
    seller: entry.user_full_name ?? "Невідомо",
    photos: reportPhotoUrls(entry).flatMap((raw) => raw.startsWith("sb:") ? (signedByPath.get(raw.slice(3)) ? [signedByPath.get(raw.slice(3))!] : []) : isLegacyPublicUrl(raw) ? [raw] : []),
  }));

  console.log(JSON.stringify({ level: "info", event: "photo_report.gallery.opened", store_id: storeId, date, reports: reports.length, actor_user_id: session.uid, request_id: req.headers.get("x-request-id") }));
  return NextResponse.json({ reports });
}
