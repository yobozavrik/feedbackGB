import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canUseUtilityStore, utilityContext, validUuid } from "@/lib/utilityAccess";

export const runtime = "nodejs";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const CATEGORIES = new Set(["electricity", "water", "heating", "other"]);

function imageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** One photo per request keeps the request below hosting body limits. */
export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PHOTO_BYTES + 64 * 1024) return NextResponse.json({ error: "photo_too_large" }, { status: 413 });
  const context = await utilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const { db, actor } = context;
  const form = await req.formData().catch(() => null);
  const storeId = Number(form?.get("store_id"));
  const periodId = form?.get("period_id");
  const category = form?.get("category");
  const photo = form?.get("photo");
  if (!Number.isInteger(storeId) || storeId <= 0 || !validUuid(periodId)
    || typeof category !== "string" || !CATEGORIES.has(category) || !(photo instanceof File)) {
    return NextResponse.json({ error: "invalid_upload" }, { status: 400 });
  }
  if (!(await canUseUtilityStore(db, actor, storeId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (photo.size < 1 || photo.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "photo_too_large" }, { status: 413 });
  const { data: period, error: periodError } = await db.from("utility_periods")
    .select("id,period_start,period_end,due_at,status").eq("id", periodId).maybeSingle();
  if (periodError) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if (!period || period.status !== "open" || new Date(period.due_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "period_closed" }, { status: 409 });
  }
  const { count: pendingCount, error: countError } = await db.from("utility_uploads")
    .select("id", { count: "exact", head: true }).eq("user_id", actor.id).eq("category", category)
    .is("claimed_by", null).gte("expires_at", new Date().toISOString());
  if (countError) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if ((pendingCount ?? 0) >= 30) return NextResponse.json({ error: "too_many_pending_photos" }, { status: 429 });
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return NextResponse.json({ error: "invalid_photo_type" }, { status: 400 });
  const id = randomUUID();
  const path = `utility/${storeId}/${periodId}/${category}/${id}.${type.ext}`;
  const { error: storageError } = await db.storage.from("utility-reading-photos")
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (storageError) return NextResponse.json({ error: "storage_failed" }, { status: 503 });
  const { error: insertError } = await db.from("utility_uploads").insert({
    id, user_id: actor.id, store_id: storeId, period_id: periodId, category,
    storage_path: path, mime: type.mime, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (insertError) {
    await db.storage.from("utility-reading-photos").remove([path]);
    return NextResponse.json({ error: "upload_record_failed" }, { status: 503 });
  }
  return NextResponse.json({ upload_id: id, bytes: bytes.length, mime: type.mime });
}
