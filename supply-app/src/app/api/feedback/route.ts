import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getServerSupabase } from "@/lib/supabase";
import { getWarehouseCrmSupabase } from "@/lib/warehouseCrm";
import { validateFeedbackPayload } from "@/lib/feedbackValidation";
import { buildSummary } from "@/lib/summary";
import { resolveAssignedAdmin } from "@/lib/assignment";
import { classifyConsumablesCrmFailure } from "@/lib/consumablesOrderError";
import type { FeedbackPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Consumables now flow through the supply-sibling CRM RPC. Sырьё-документи
// (raw materials, defects, incoming invoices) live outside the feedback table
// per ADR 0004 and are added later.
const ALLOWED_CATEGORIES = new Set(["hr_question", "consumables_request", "tech_issue"]);

/**
 * POST /api/feedback — create HR or consumables request for the authenticated
 * supply user. Server owns identity: facility_id + store_label come from the
 * session, never from the client. store_id stays NULL for supply rows.
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
  const { category, cleanFields, clientSubmissionId, clientCreatedAt, cartItems, rawPhotos } = validated.data;

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

  // Photo (sick-leave certificate for HR; not used by consumables): base64
  // data URL only, private bucket.
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

  // Auto-assign the responsible admin: admin_directions rule with
  // store_id IS NULL. Never blocks — resolveAssignedAdmin swallows errors.
  const assignedTo = await resolveAssignedAdmin(supabase, category.id, null);

  // Consumables: RPC BEFORE the journal insert. The user must not see success
  // if the warehouse rejected the order. feedback.id === client_submission_id
  // so a retry hits the idempotency key both in feedbackgb_order_contributions
  // (in CRM) and in feedback (via unique client_submission_id).
  const record: Record<string, unknown> = {
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

  if (category.id === "consumables_request") {
    if (!cartItems) {
      return NextResponse.json({ error: "Кошик порожній" }, { status: 400 });
    }
    if (!user.facilityId) {
      return NextResponse.json({ error: "Твій цех/склад не прив'язано" }, { status: 400 });
    }
    const { data: facility, error: facilityErr } = await supabase
      .from("facilities")
      .select("crm_location_id")
      .eq("id", user.facilityId)
      .maybeSingle();
    if (facilityErr) {
      console.error("[supply] facility lookup", { code: facilityErr.code });
      return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
    }
    const rawShopId = (facility as { crm_location_id: string | null } | null)?.crm_location_id;
    const crmShopId = rawShopId != null ? Number(rawShopId) : NaN;
    if (!Number.isFinite(crmShopId)) {
      return NextResponse.json(
        { error: "Твій цех/склад не має CRM-прив'язки. Зверніться до супер-адміністратора." },
        { status: 400 },
      );
    }

    // Pre-assign feedback.id so it matches client_submission_id — CRM stores
    // this as feedbackgb_order_contributions.feedback_id and it's the sole
    // idempotency key across retries.
    const feedbackId = clientSubmissionId ?? randomUUID();
    record.id = feedbackId;
    record.cart_items = cartItems;

    const warehouse = getWarehouseCrmSupabase();
    if (!warehouse) {
      return NextResponse.json({ error: "Складський модуль недоступний" }, { status: 503 });
    }
    const { data: crmResult, error: crmError } = await warehouse.rpc(
      "rpc_create_feedbackgb_supply_consumables_order",
      {
        p_feedback_id: feedbackId,
        p_feedback_user_id: user.id,
        p_crm_shop_id: crmShopId,
        p_notes: typeof cleanFields.comment === "string" ? cleanFields.comment : null,
        p_items: cartItems,
      },
    );
    const crm = crmResult as { success?: boolean; error?: string; order_id?: string } | null;
    if (crmError || !crm?.success || !crm.order_id) {
      const failure = classifyConsumablesCrmFailure(crmError, crm);
      console.error("[supply] consumables CRM failed", { code: crmError?.code, status: failure.status });
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
  }

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

  return NextResponse.json({ ok: true, id: (inserted as { id: string } | null)?.id ?? null });
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
