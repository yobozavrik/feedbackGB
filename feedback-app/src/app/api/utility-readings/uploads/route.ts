import { createHash, randomUUID } from "node:crypto";
import { canUseUtilityStore, utilityContext, validUuid } from "@/lib/utilityAccess";
import { utilityTrace } from "@/lib/utilityLog";

export const runtime = "nodejs";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PHOTO_BYTES + 64 * 1024;
const CATEGORIES = new Set(["electricity", "water", "heating", "other"]);

async function boundedFormData(req: Request): Promise<FormData | "too_large" | null> {
  const contentType = req.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;") || !req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        return "too_large";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return await new Request(req.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function imageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** One photo per request keeps the request below hosting body limits. */
export async function POST(req: Request) {
  const trace = utilityTrace(req, "POST /api/utility-readings/uploads");
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return trace.fail("photo_too_large", 413, "utility.upload.too_large", "info");
  const context = await utilityContext();
  if ("error" in context) return trace.fail(context.error, context.status,
    context.status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
    context.status >= 500 ? "error" : "warn");
  const { db, actor } = context;
  const form = await boundedFormData(req);
  if (form === "too_large") return trace.fail("photo_too_large", 413, "utility.upload.too_large", "info");
  const storeId = Number(form?.get("store_id"));
  const periodId = form?.get("period_id");
  const category = form?.get("category");
  const clientSubmissionId = form?.get("client_submission_id");
  const photo = form?.get("photo");
  if (!Number.isInteger(storeId) || storeId <= 0 || !validUuid(periodId)
    || typeof category !== "string" || !CATEGORIES.has(category) || !(photo instanceof File)
    || (clientSubmissionId !== null && !validUuid(clientSubmissionId))) {
    return trace.fail("invalid_upload", 400, "utility.upload.invalid", "info");
  }
  if (!(await canUseUtilityStore(db, actor, storeId))) return trace.fail("forbidden", 403, "utility.access.denied", "warn", { store_id: storeId });
  if (photo.size < 1 || photo.size > MAX_PHOTO_BYTES) return trace.fail("photo_too_large", 413, "utility.upload.too_large", "info", { store_id: storeId });
  const { data: period, error: periodError } = await db.from("utility_periods")
    .select("id,period_start,period_end,due_at,status").eq("id", periodId).maybeSingle();
  if (periodError) return trace.fail("query_failed", 500, "utility.period.read_failed", "error", { store_id: storeId, period_id: periodId });
  if (!period) return trace.fail("period_closed", 409, "utility.period.closed", "info", { store_id: storeId, period_id: periodId });
  if (period.status !== "open" || new Date(period.due_at).getTime() < Date.now()) {
    const { data: prior, error: priorError } = await db.from("utility_submissions").select("id")
      .eq("store_id", storeId).eq("period_id", periodId).eq("category", category)
      .is("superseded_at", null).maybeSingle();
    if (priorError) return trace.fail("query_failed", 500, "utility.upload.prior_read_failed", "error",
      { store_id: storeId, period_id: periodId, category });
    if (!prior) return trace.fail("period_closed", 409, "utility.period.closed", "info",
      { store_id: storeId, period_id: periodId, category });
  }
  const { count: pendingCount, error: countError } = await db.from("utility_uploads")
    .select("id", { count: "exact", head: true }).eq("user_id", actor.id).eq("category", category)
    .is("claimed_by", null).gte("expires_at", new Date().toISOString());
  if (countError) return trace.fail("query_failed", 500, "utility.upload.pending_count_failed", "error", { store_id: storeId, period_id: periodId });
  if ((pendingCount ?? 0) >= 30) return trace.fail("too_many_pending_photos", 429, "utility.upload.pending_limit", "info", { store_id: storeId });
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return trace.fail("invalid_photo_type", 400, "utility.upload.invalid", "info", { store_id: storeId });
  const id = randomUUID();
  const path = `utility/${storeId}/${periodId}/${category}/${id}.${type.ext}`;
  const { error: storageError } = await db.storage.from("utility-reading-photos")
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (storageError) return trace.fail("storage_failed", 503, "utility.upload.storage_failed", "error",
    { phase: "storage_upload", store_id: storeId, period_id: periodId, category, upload_id: id,
      client_submission_id: clientSubmissionId ?? undefined });
  const { error: insertError } = await db.from("utility_uploads").insert({
    id, user_id: actor.id, store_id: storeId, period_id: periodId, category,
    storage_path: path, mime: type.mime, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insertError) {
    trace.log("utility.upload.record_failed", "error", { phase: "metadata_insert", store_id: storeId, period_id: periodId, category, upload_id: id,
      client_submission_id: clientSubmissionId ?? undefined, error_code: "upload_record_failed" });
    const { error: compensationError } = await db.storage.from("utility-reading-photos").remove([path]);
    if (compensationError) trace.log("utility.upload.compensation_failed", "critical",
      { phase: "storage_compensation", store_id: storeId, period_id: periodId, category, upload_id: id,
        client_submission_id: clientSubmissionId ?? undefined, error_code: "compensation_failed" });
    return trace.json({ error: "upload_record_failed" }, 503);
  }
  return trace.json({ upload_id: id, bytes: bytes.length, mime: type.mime });
}
