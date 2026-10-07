import { NextResponse } from "next/server";
import { adminUtilityContext } from "@/lib/admin/utilityAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }
  const context = await adminUtilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!uuid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db } = context;
  const [submissionResult, photosResult, eventsResult, jobResult] = await Promise.all([
    db.from("utility_submissions")
      .select("id,store_id,period_id,category,comment,submitted_by,submitted_at,revision,supersedes_id,review_status,review_note,reviewed_at")
      .eq("id", id).maybeSingle(),
    db.from("utility_photos").select("id,upload_id,sort_order")
      .eq("submission_id", id).order("sort_order"),
    db.from("utility_events").select("event,created_at,actor_id,details")
      .eq("submission_id", id).order("created_at"),
    db.from("utility_delivery_jobs").select("state,attempts,sent_at,last_error_code,message_ids")
      .eq("submission_id", id).maybeSingle(),
  ]);
  if (submissionResult.error || photosResult.error || eventsResult.error || jobResult.error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
  const submission = submissionResult.data;
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: versions, error: versionsError } = await db.from("utility_submissions")
    .select("id,revision,submitted_at,review_status,superseded_at")
    .eq("store_id", submission.store_id).eq("period_id", submission.period_id)
    .eq("category", submission.category).order("revision", { ascending: false });
  if (versionsError) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  const ids = (photosResult.data ?? []).map((photo) => photo.upload_id);
  const { data: uploads, error: uploadError } = ids.length
    ? await db.from("utility_uploads").select("id,storage_path,mime,bytes").in("id", ids)
    : { data: [], error: null };
  if (uploadError) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  const paths = (uploads ?? []).map((upload) => upload.storage_path);
  const { data: signed, error: signError } = paths.length
    ? await db.storage.from("utility-reading-photos").createSignedUrls(paths, 10 * 60)
    : { data: [], error: null };
  if (signError) return NextResponse.json({ error: "signing_failed" }, { status: 500 });
  const urlByPath = new Map((signed ?? []).flatMap((item) => item.path && item.signedUrl
    ? [[item.path, item.signedUrl] as const] : []));
  const uploadById = new Map((uploads ?? []).map((upload) => [upload.id, upload]));
  const photos = (photosResult.data ?? []).map((photo) => {
    const upload = uploadById.get(photo.upload_id);
    return { id: photo.id, url: upload ? urlByPath.get(upload.storage_path) ?? null : null };
  });
  return NextResponse.json({ submission, photos, versions: versions ?? [],
    events: eventsResult.data ?? [], delivery: jobResult.data ?? null });
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }
  const context = await adminUtilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const { db, actor } = context;
  const raw = await req.text();
  if (raw.length > 8_192) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!uuid(body.id) || !["verified", "needs_correction"].includes(String(body.status))
    || (body.note != null && (typeof body.note !== "string" || body.note.length > 1000))) {
    return NextResponse.json({ error: "invalid_review" }, { status: 400 });
  }
  if (body.status === "needs_correction" && (!body.note || !String(body.note).trim())) {
    return NextResponse.json({ error: "review_note_required" }, { status: 400 });
  }
  const { error } = await db.rpc("review_utility_submission", {
    p_submission_id: body.id, p_actor_id: actor.id, p_status: body.status,
    p_note: typeof body.note === "string" ? body.note : null,
  });
  if (error) return NextResponse.json({ error: "review_conflict" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
