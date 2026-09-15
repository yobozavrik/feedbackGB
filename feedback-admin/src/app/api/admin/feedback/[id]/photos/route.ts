import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { reportPhotoUrls, type PhotoReportEntry } from "@/lib/photoReport";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 10 * 60;

async function resolvePhotoUrl(supabase: NonNullable<ReturnType<typeof getServerSupabase>>, raw: string): Promise<string | null> {
  if (raw.startsWith("sb:")) {
    const { data, error } = await supabase.storage.from("feedback-photos").createSignedUrl(raw.slice(3), SIGNED_URL_TTL_SECONDS);
    return error || !data?.signedUrl ? null : data.signedUrl;
  }
  if (raw.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/`)) return raw;
  return null;
}

/** Returns all photos for one feedback row as temporary URLs, for admin-only preview. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!await requireAdminSession()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });
  const { data, error } = await supabase
    .from("feedback_feed")
    .select("created_at,store_id,store_name,user_full_name,photo_url,photo_urls")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const photos = (await Promise.all(
    reportPhotoUrls(data as PhotoReportEntry).map((url) => resolvePhotoUrl(supabase, url)),
  )).filter((url): url is string => url !== null);
  return NextResponse.json({ photos });
}
