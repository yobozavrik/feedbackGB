import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { rateLimit } from "@/lib/rateLimit";
import { ipFromRequest } from "@/lib/audit";

/**
 * Photo redirect endpoint used by the daily report.
 *
 * Flow: report renders `📷` as `<a href="/api/r/photo/<feedback_id>">📷</a>`
 *       → user clicks → this handler 302-redirects to a freshly-minted
 *       signed URL on Supabase Storage (or, when REPORT_PHOTO_LINK_MODE=drive,
 *       to the mirrored Google Drive view URL).
 *
 * Why a redirect:
 *   1. Hides the JWT from Telegram's hover/long-press preview.
 *   2. Links never expire — the signed URL is generated just-in-time on
 *      each click, so links posted months ago still work.
 *   3. Centralises mode-switching: REPORT_PHOTO_LINK_MODE flips behaviour
 *      without changing the report format or the link shape.
 *
 * Auth: open. The feedback UUID itself is the capability token (random
 * 128-bit identifier, not enumerable). A modest per-IP rate limit blocks
 * naive scraping.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short TTL: redirect-target only needs to live long enough for the
// browser/Telegram to fetch the bytes. 10 minutes is plenty.
const REDIRECT_SIGNED_URL_TTL_SEC = 10 * 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FeedbackPhotoRow {
  id: string;
  photo_url: string | null;
}

interface MirrorRow {
  drive_file_id: string | null;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const id = params.id;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  // 60 redirects/min/IP is enough for a human in a chat and breaks
  // automated scraping cold.
  const ip = ipFromRequest(req) ?? "unknown";
  const rl = rateLimit(`photo-redirect:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("feedback")
    .select("id, photo_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("photo-redirect db error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  const row = data as FeedbackPhotoRow | null;
  if (!row || !row.photo_url) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const mode = (
    process.env.REPORT_PHOTO_LINK_MODE ?? "supabase"
  ).toLowerCase();

  if (mode === "drive") {
    const { data: mirror } = await supabase
      .from("photo_mirror")
      .select("drive_file_id")
      .eq("feedback_id", row.id)
      .maybeSingle();
    const driveId = (mirror as MirrorRow | null)?.drive_file_id;
    if (driveId) {
      return NextResponse.redirect(
        `https://drive.google.com/file/d/${driveId}/view`,
        302,
      );
    }
    // Fall through to Supabase signed URL if mirror hasn't run yet.
  }

  if (row.photo_url.startsWith("sb:")) {
    const path = row.photo_url.slice(3);
    const { data: signed, error: signErr } = await supabase.storage
      .from("feedback-photos")
      .createSignedUrl(path, REDIRECT_SIGNED_URL_TTL_SEC);
    if (signErr || !signed?.signedUrl) {
      console.error("photo-redirect signed-url error", { code: signErr?.name });
      return NextResponse.json({ error: "sign_failed" }, { status: 500 });
    }
    return NextResponse.redirect(signed.signedUrl, 302);
  }

  // Legacy public URL — redirect straight to it.
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (
    projectUrl &&
    row.photo_url.startsWith(
      `${projectUrl}/storage/v1/object/public/feedback-photos/`,
    )
  ) {
    return NextResponse.redirect(row.photo_url, 302);
  }

  return NextResponse.json({ error: "unsupported_photo_url" }, { status: 400 });
}
