import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getServerSupabase } from "@/lib/supabase";
import { validateFeedbackPayload } from "@/lib/feedbackValidation";
import { buildSummary } from "@/lib/summary";
import { resolveAssignedAdmin } from "@/lib/assignment";
import type { FeedbackPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Phase B ships HR only. Consumables (a direct CRM call) lands in Phase C.
const ALLOWED_CATEGORIES = new Set(["hr_question"]);

/**
 * POST /api/feedback — create an HR request for the authenticated supply user.
 * Server owns identity: facility_id + store_label come from the session, never
 * from the client. store_id stays NULL for supply rows.
 */
export async function POST(request: Request) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: FeedbackPayload;
  try {
    payload = JSON.parse(raw) as FeedbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validateFeedbackPayload(payload);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status });
  }
  const { category, cleanFields, clientSubmissionId, clientCreatedAt, rawPhotos } = validated.data;

  if (!ALLOWED_CATEGORIES.has(category.id)) {
    return NextResponse.json({ error: "Ця категорія недоступна в supply-app" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Сервіс недоступний" }, { status: 503 });
  }

  // Transfer target: resolve the facility name server-side; never trust a
  // client-supplied label. target_facility_id is validated as a uuid already.
  if (cleanFields["hr_topic"] === "transfer" && typeof cleanFields["target_facility_id"] === "string") {
    const { data: target, error: targetErr } = await supabase
      .from("facilities")
      .select("name")
      .eq("id", cleanFields["target_facility_id"])
      .eq("is_active", true)
      .maybeSingle();
    if (targetErr || !target) {
      return NextResponse.json({ error: "Обраний цех/склад для переведення не знайдено" }, { status: 400 });
    }
    cleanFields["target_facility_name"] = (target as { name: string }).name;
  }

  // Photo (sick-leave certificate): base64 data URL only, private bucket.
  const photoUrls: string[] = [];
  for (const rawPhoto of rawPhotos) {
    if (typeof rawPhoto !== "string") continue;
    const stored = await sanitizeAndUploadPhoto(supabase, rawPhoto);
    if (stored) photoUrls.push(stored);
  }
  const photoUrl = photoUrls[0] ?? null;

  const summary = buildSummary(
    { ...payload, fields: cleanFields, store_label: user.facilityName, photo_url: photoUrl },
    { display_name: user.name },
    user.facilityName,
  );

  // Route supply HR requests to the admin from admin_directions with
  // store_id IS NULL ("all stores"). Never blocks: resolveAssignedAdmin
  // swallows its own errors and returns null (unassigned).
  const assignedTo = await resolveAssignedAdmin(supabase, category.id, null);

  const record = {
    category: category.id,
    store_id: null,
    store_label: user.facilityName,
    facility_id: user.facilityId,
    user_id: user.id,
    fields: cleanFields,
    photo_url: photoUrl,
    tg_verified: false,
    summary,
    assigned_to: assignedTo,
    client_submission_id: clientSubmissionId,
    client_created_at: clientCreatedAt,
  };

  const { data: inserted, error } = await supabase
    .from("feedback")
    .insert(record)
    .select("id")
    .single();
  if (error) {
    // Idempotent retry: same client_submission_id from the same user is a dup.
    if (error.code === "23505" && clientSubmissionId) {
      const { data: existing } = await supabase
        .from("feedback")
        .select("id, user_id")
        .eq("client_submission_id", clientSubmissionId)
        .maybeSingle();
      if (existing && (existing as { user_id: string }).user_id === user.id) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
    }
    console.error("[supply] feedback insert", { code: error.code });
    return NextResponse.json({ error: "Помилка збереження" }, { status: 500 });
  }

  // Stamp the trigger-written audit row with the real actor.
  if (inserted) {
    await supabase
      .from("audit_log")
      .update({ actor: user.id, actor_user_id: user.id })
      .eq("feedback_id", (inserted as { id: string }).id)
      .is("actor_user_id", null);
  }

  return NextResponse.json({ ok: true });
}

async function sanitizeAndUploadPhoto(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  raw: string,
): Promise<string | null> {
  const match = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!ALLOWED_PHOTO_MIME.has(mime)) return null;

  let buf: Buffer;
  try {
    buf = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > MAX_PHOTO_BYTES) return null;

  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("feedback-photos")
    .upload(path, buf, { contentType: mime, upsert: false });
  if (error) {
    console.warn("[supply] photo upload failed");
    return null;
  }
  return `sb:${path}`;
}
