import { adminUtilityContext } from "@/lib/admin/utilityAccess";
import { utilityTrace } from "@/lib/admin/utilityLog";
import { utilityReadingsEnabled } from "@/lib/admin/utilityFeature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

export async function GET(req: Request) {
  const trace = utilityTrace(req, "GET /api/admin/utility-readings/submissions");
  if (!utilityReadingsEnabled()) {
    return trace.fail("feature_disabled", 404, "utility.access.denied", "warn");
  }
  const context = await adminUtilityContext();
  if ("error" in context) {
    const status = context.status ?? 500;
    return trace.fail(context.error ?? "backend_unavailable", status,
      status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
      status >= 500 ? "error" : "warn");
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!uuid(id)) return trace.fail("invalid_id", 400, "utility.admin.invalid", "info");
  const { db } = context;
  const [submissionResult, photosResult, eventsResult, jobResult] = await Promise.all([
    db.from("utility_submissions")
      .select("id,store_id,period_id,category,comment,submitted_by,submitted_at,revision,supersedes_id,superseded_at,review_status,review_note,reviewed_at")
      .eq("id", id).maybeSingle(),
    db.from("utility_photos").select("id,upload_id,sort_order")
      .eq("submission_id", id).order("sort_order"),
    db.from("utility_events").select("event,created_at,actor_id,details")
      .eq("submission_id", id).order("created_at"),
    db.from("utility_delivery_jobs").select("state,attempts,sent_at,last_error_code,message_ids")
      .eq("submission_id", id).maybeSingle(),
  ]);
  if (submissionResult.error || photosResult.error || eventsResult.error || jobResult.error) {
    return trace.fail("query_failed", 500, "utility.admin.read_failed", "error", { submission_id: id });
  }
  const submission = submissionResult.data;
  if (!submission) return trace.fail("not_found", 404, "utility.admin.not_found", "info", { submission_id: id });
  const { data: versions, error: versionsError } = await db.from("utility_submissions")
    .select("id,revision,submitted_at,review_status,superseded_at")
    .eq("store_id", submission.store_id).eq("period_id", submission.period_id)
    .eq("category", submission.category).order("revision", { ascending: false });
  if (versionsError) return trace.fail("query_failed", 500, "utility.admin.read_failed", "error", { submission_id: id });
  const ids = (photosResult.data ?? []).map((photo) => photo.upload_id);
  const { data: uploads, error: uploadError } = ids.length
    ? await db.from("utility_uploads").select("id,storage_path,mime,bytes").in("id", ids)
    : { data: [], error: null };
  if (uploadError) return trace.fail("query_failed", 500, "utility.admin.read_failed", "error", { submission_id: id });
  const paths = (uploads ?? []).map((upload) => upload.storage_path);
  const { data: signed, error: signError } = paths.length
    ? await db.storage.from("utility-reading-photos").createSignedUrls(paths, 10 * 60)
    : { data: [], error: null };
  if (signError) return trace.fail("signing_failed", 500, "utility.admin.sign_failed", "error", { submission_id: id });
  const urlByPath = new Map((signed ?? []).flatMap((item) => item.path && item.signedUrl
    ? [[item.path, item.signedUrl] as const] : []));
  const uploadById = new Map((uploads ?? []).map((upload) => [upload.id, upload]));
  const photos = (photosResult.data ?? []).map((photo) => {
    const upload = uploadById.get(photo.upload_id);
    return { id: photo.id, url: upload ? urlByPath.get(upload.storage_path) ?? null : null };
  });
  return trace.json({ submission, photos, versions: versions ?? [],
    events: eventsResult.data ?? [], delivery: jobResult.data ?? null });
}

export async function POST(req: Request) {
  const trace = utilityTrace(req, "POST /api/admin/utility-readings/submissions");
  if (!utilityReadingsEnabled()) {
    return trace.fail("feature_disabled", 404, "utility.access.denied", "warn");
  }
  const context = await adminUtilityContext();
  if ("error" in context) {
    const status = context.status ?? 500;
    return trace.fail(context.error ?? "backend_unavailable", status,
      status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
      status >= 500 ? "error" : "warn");
  }
  const { db, actor } = context;
  const raw = await req.text();
  if (raw.length > 8_192) return trace.fail("payload_too_large", 413, "utility.admin.invalid", "info");
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { return trace.fail("invalid_json", 400, "utility.admin.invalid", "info"); }
  if (!uuid(body.id) || !["verified", "needs_correction"].includes(String(body.status))
    || (body.note != null && (typeof body.note !== "string" || body.note.length > 1000))) {
    return trace.fail("invalid_review", 400, "utility.admin.invalid", "info");
  }
  if (body.status === "needs_correction" && (!body.note || !String(body.note).trim())) {
    return trace.fail("review_note_required", 400, "utility.admin.invalid", "info", { submission_id: body.id });
  }
  const { error } = await db.rpc("review_utility_submission", {
    p_submission_id: body.id, p_actor_id: actor.id, p_status: body.status,
    p_note: typeof body.note === "string" ? body.note : null,
  });
  if (error) return trace.fail("review_conflict", 409, "utility.admin.review_failed", "error", { submission_id: body.id });
  return trace.json({ ok: true });
}
