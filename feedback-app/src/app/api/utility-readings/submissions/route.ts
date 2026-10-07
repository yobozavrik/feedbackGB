import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { canUseUtilityStore, utilityContext, validUuid } from "@/lib/utilityAccess";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
const CATEGORIES = new Set(["electricity", "water", "heating", "other"]);

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const context = await utilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const { db, actor } = context;
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const storeId = Number(body.store_id);
  const category = body.category;
  const comment = body.comment == null ? null : body.comment;
  const uploadIds = body.upload_ids;
  if (!Number.isInteger(storeId) || storeId <= 0 || !validUuid(body.period_id)
    || !validUuid(body.client_submission_id) || typeof category !== "string" || !CATEGORIES.has(category)
    || (comment !== null && (typeof comment !== "string" || comment.length > 1000))
    || !Array.isArray(uploadIds) || uploadIds.length < 1 || uploadIds.length > 15
    || !uploadIds.every(validUuid) || new Set(uploadIds).size !== uploadIds.length) {
    return NextResponse.json({ error: "invalid_packet" }, { status: 400 });
  }
  if (!(await canUseUtilityStore(db, actor, storeId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
    return NextResponse.json({ error: forbidden ? "forbidden" : conflict ? "conflict" : "submission_failed" },
      { status: forbidden ? 403 : conflict ? 409 : 422 });
  }
  const { data: job } = await db.from("utility_delivery_jobs").select("state")
    .eq("submission_id", data).maybeSingle();
  return NextResponse.json({ submission_id: data, saved: true, telegram_status: job?.state ?? "pending" });
}
