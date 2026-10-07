import { createHash } from "node:crypto";
import { canUseUtilityStore, utilityContext, validUuid } from "@/lib/utilityAccess";
import { utilityTrace } from "@/lib/utilityLog";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
const CATEGORIES = new Set(["electricity", "water", "heating", "other"]);

export async function POST(req: Request) {
  const trace = utilityTrace(req, "POST /api/utility-readings/submissions");
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return trace.fail("payload_too_large", 413, "utility.submission.invalid", "info");
  const context = await utilityContext();
  if ("error" in context) return trace.fail(context.error, context.status,
    context.status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
    context.status >= 500 ? "error" : "warn");
  const { db, actor } = context;
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { return trace.fail("invalid_json", 400, "utility.submission.invalid", "info"); }
  const storeId = Number(body.store_id);
  const category = body.category;
  const comment = body.comment == null ? null : body.comment;
  const uploadIds = body.upload_ids;
  if (!Number.isInteger(storeId) || storeId <= 0 || !validUuid(body.period_id)
    || !validUuid(body.client_submission_id) || typeof category !== "string" || !CATEGORIES.has(category)
    || (comment !== null && (typeof comment !== "string" || comment.length > 1000))
    || !Array.isArray(uploadIds) || uploadIds.length < 1 || uploadIds.length > 15
    || !uploadIds.every(validUuid) || new Set(uploadIds).size !== uploadIds.length) {
    return trace.fail("invalid_packet", 400, "utility.submission.invalid", "info");
  }
  if (!(await canUseUtilityStore(db, actor, storeId))) return trace.fail("forbidden", 403, "utility.access.denied", "warn", { store_id: storeId });
  const payloadSha256 = createHash("sha256").update(JSON.stringify({
    storeId, periodId: body.period_id, category, comment, uploadIds,
  })).digest("hex");
  const { data, error } = await db.rpc("submit_utility_photos", {
    p_store_id: storeId, p_period_id: body.period_id, p_category: category,
    p_user_id: actor.id, p_client_submission_id: body.client_submission_id,
    p_payload_sha256: payloadSha256, p_comment: comment, p_upload_ids: uploadIds,
  });
  if (error) {
    const message = error.message ?? "";
    const conflict = /idempotency|verified_revision|period_closed|deadline/.test(message);
    const forbidden = /forbidden/.test(message);
    const code = forbidden ? "forbidden" : conflict ? "conflict" : "submission_failed";
    return trace.fail(code, forbidden ? 403 : conflict ? 409 : 422,
      conflict || forbidden ? "utility.submission.rejected" : "utility.submission.rpc_failed",
      conflict || forbidden ? "info" : "error",
      { store_id: storeId, period_id: body.period_id, category, client_submission_id: body.client_submission_id });
  }
  const { data: job, error: jobError } = await db.from("utility_delivery_jobs").select("state")
    .eq("submission_id", data).maybeSingle();
  if (jobError) trace.log("utility.submission.delivery_read_failed", "error",
    { submission_id: data, error_code: "delivery_read_failed" });
  return trace.json({ submission_id: data, saved: true, telegram_status: job?.state ?? "pending" });
}
