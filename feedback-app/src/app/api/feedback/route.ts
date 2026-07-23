import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateFeedbackPayload } from "@/lib/feedbackValidation";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { buildSummary } from "@/lib/summary";
import { validateInitData } from "@/lib/telegram";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { resolveAssignedAdmin } from "@/lib/assignment";
import { createNotification } from "@/lib/notifications";
import { getWarehouseCrmSupabase } from "@/lib/warehouseCrm";
import { classifyConsumablesCrmFailure } from "@/lib/consumablesOrderError";
import type { FeedbackPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // enough for several compressed photos
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB decoded
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/feedback
 * Creates a feedback record for the authenticated user.
 * Middleware enforces session; role is ignored for POST (everyone can submit).
 */
export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 },
    );
  }

  // Middleware already enforces a session; defence in depth here.
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 },
    );
  }

  let payload: FeedbackPayload;
  try {
    payload = JSON.parse(raw) as FeedbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validateFeedbackPayload(payload);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: validated.status },
    );
  }
  const {
    category,
    cleanFields,
    storeLabel,
    clientSubmissionId,
    clientCreatedAt,
    productId,
    quantity,
    cartItems,
    rawPhotos,
  } = validated.data;

  // TG init_data is strictly optional. We only copy TG identity into the DB
  // if HMAC validation succeeded — never trust the client's claimed TG id.
  const initData =
    typeof payload.init_data === "string" && payload.init_data.length < 8192
      ? payload.init_data
      : undefined;
  const { user: tgUser, valid: tgValid } = validateInitData(
    initData,
    process.env.TELEGRAM_BOT_TOKEN,
  );

  // For sellers, server-side trusted store_id overrides any client-supplied value.
  const effectiveStoreId =
    sess.role === "seller" && sess.store_id != null
      ? sess.store_id
      : typeof payload.store_id === "number" && Number.isFinite(payload.store_id)
        ? payload.store_id
        : null;

  const supabase = getServerSupabase();

  // HR transfer requests: never trust the client's target_store_name label —
  // look the real name up by target_store_id, same as effectiveStoreId below,
  // and reject outright if the id doesn't correspond to a real store.
  if (supabase && category.id === "hr_question" && cleanFields["hr_topic"] === "transfer") {
    const targetStoreId = cleanFields["target_store_id"];
    const { data: targetStore, error: targetStoreErr } = await supabase
      .from("v_stores")
      .select("name")
      .eq("id", targetStoreId)
      .maybeSingle();
    if (targetStoreErr || !targetStore) {
      return NextResponse.json(
        { error: "Обраний магазин/цех для переведення не знайдено" },
        { status: 400 },
      );
    }
    cleanFields["target_store_name"] = (targetStore as { name: string }).name;
  }

  // photo handling: accept ONLY a base64 data: URL for a whitelisted image
  // mime. Anything else (arbitrary http(s):// URLs, javascript:, data: with
  // non-image mime, oversized) is dropped — never stored.
  let photoUrl: string | null = null;
  const photoUrls: string[] = [];
  if (supabase && rawPhotos.length > 0) {
    for (const rawPhoto of rawPhotos) {
      if (typeof rawPhoto !== "string") continue;
      const safePath = await sanitizeAndUploadPhoto(supabase, rawPhoto);
      if (safePath) photoUrls.push(safePath);
    }
    photoUrl = photoUrls[0] ?? null;
  }

  let storeName: string | null = null;
  if (supabase && effectiveStoreId) {
    const { data } = await supabase
      .from("v_stores")
      .select("name")
      .eq("id", effectiveStoreId)
      .maybeSingle();
    storeName = (data as { name: string } | null)?.name ?? null;
  }

  const display = sess.full_name;

  // Look up product name for the summary and for storing a redundant
  // display string on the fields jsonb (helpful for legacy admin view).
  let productName: string | null = null;
  let productUnit: string | null = null;
  if (supabase && productId !== null) {
    const { data } = await supabase
      .from("v_products")
      .select("name, unit")
      .eq("id", productId)
      .maybeSingle();
    const p = data as { name: string | null; unit: string | null } | null;
    productName = p?.name ?? null;
    productUnit = p?.unit ?? null;
  }

  // Surface product_name + quantity in fields so buildSummary and legacy
  // admin/CSV consumers render the same string as before without needing a
  // schema change.
  const fieldsForSummary: Record<string, string | number | null> = {
    ...cleanFields,
  };
  if (productName) fieldsForSummary["product_name"] = productName;
  if (quantity !== null) fieldsForSummary["quantity"] = quantity;
  if (productUnit) fieldsForSummary["product_unit"] = productUnit;
  if (photoUrls.length > 1) fieldsForSummary["photo_count"] = photoUrls.length;

  const summary = buildSummary(
    {
      ...payload,
      product_id: productId,
      quantity: quantity,
      fields: fieldsForSummary,
      store_id: effectiveStoreId,
      store_label: storeLabel,
      photo_url: photoUrl,
      photo_urls: photoUrls,
    },
    {
      display_name: display,
      username: tgValid ? tgUser?.username ?? null : null,
    },
    storeName,
  );

  // Auto-assign the responsible admin based on feedbackgb.admin_directions
  // (see feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md). Never blocks
  // submission: resolveAssignedAdmin swallows its own errors and falls
  // back to null (unassigned), same as today's behavior.
  const assignedTo = supabase
    ? await resolveAssignedAdmin(supabase, category.id, effectiveStoreId)
    : null;

  const record = {
    ...(category.id === "consumables_request"
      ? { id: clientSubmissionId ?? randomUUID() }
      : {}),
    category: category.id,
    store_id: effectiveStoreId,
    store_label: storeLabel,
    user_id: sess.uid,
    product_id: productId,
    quantity: quantity,
    cart_items: cartItems,
    fields: {
      ...cleanFields,
      ...(photoUrls.length > 1 ? { photo_urls: photoUrls } : {}),
    },
    photo_url: photoUrl,
    tg_user_id: tgValid ? tgUser?.id ?? null : null,
    tg_username: tgValid ? tgUser?.username ?? null : null,
    tg_display_name: tgValid ? display : null,
    tg_verified: tgValid,
    summary,
    assigned_to: assignedTo,
    client_submission_id: clientSubmissionId,
    client_created_at: clientCreatedAt,
  };

  if (!isSupabaseConfigured() || !supabase) {
    // Do NOT log PII — just report that the backend isn't configured.
    console.warn("[feedback] Supabase not configured; record dropped");
    return NextResponse.json({ ok: true, persisted: false });
  }

  // Consumables are a direct server-to-server call to the warehouse CRM.
  // Do this before persisting the FeedbackGB journal record: a user must not
  // see a successful submission if the warehouse has not accepted the order.
  if (category.id === "consumables_request") {
    if (!effectiveStoreId || !cartItems) {
      return NextResponse.json({ error: "Не визначено магазин для заявки" }, { status: 400 });
    }
    const warehouse = getWarehouseCrmSupabase();
    if (!warehouse) {
      return NextResponse.json({ error: "Складський модуль недоступний" }, { status: 503 });
    }
    const { data: crmResult, error: crmError } = await warehouse.rpc(
      "rpc_create_feedbackgb_consumables_order",
      {
        p_feedback_id: record.id,
        p_feedback_user_id: sess.uid,
        p_feedback_store_id: effectiveStoreId,
        p_notes: typeof cleanFields.comment === "string" ? cleanFields.comment : null,
        p_items: cartItems,
      },
    );
    const crm = crmResult as { success?: boolean; error?: string; order_id?: string; order_number?: string } | null;
    if (crmError || !crm?.success || !crm.order_id) {
      const failure = classifyConsumablesCrmFailure(crmError, crm);
      console.error("[feedback] warehouse consumables request failed", {
        code: crmError?.code,
        status: failure.status,
        ...(failure.logStoreId ? { store_id: effectiveStoreId } : {}),
      });
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
  }

  const { data: inserted, error } = await supabase
    .from("feedback")
    .insert(record)
    .select("id")
    .single();
  if (error) {
    console.error("supabase insert error", { code: error.code });
    // Check for unique constraint violation (code 23505)
    if (error.code === "23505" && clientSubmissionId) {
      // Look up the existing record to verify owner
      const { data: existing, error: queryError } = await supabase
        .from("feedback")
        .select("id, user_id")
        .eq("client_submission_id", clientSubmissionId)
        .maybeSingle();

      if (!queryError && existing) {
        if (existing.user_id === sess.uid) {
          console.log(`Duplicate submission detected for user ${sess.uid}. Returning 200 OK.`);
          return NextResponse.json({ ok: true, persisted: true, duplicate: true });
        } else {
          console.warn(`UUID Conflict! Duplicate client_submission_id ${clientSubmissionId} owned by user ${existing.user_id}, but requested by ${sess.uid}.`);
          return NextResponse.json(
            { error: "Conflict: submission ID already exists under another user" },
            { status: 409 },
          );
        }
      }
    }
    return NextResponse.json({ error: "Помилка збереження" }, { status: 500 });
  }

  // Stamp the trigger-written audit_log row with the real actor. A prior
  // set_config-RPC-then-separate-insert approach was tried and confirmed
  // dead: each supabase-js call is its own PostgREST request/transaction, so
  // a transaction-local GUC never survives to the next request. inserted.id
  // is a brand new row, so matching by feedback_id alone is unambiguous.
  if (inserted) {
    await supabase
      .from("audit_log")
      .update({ actor: sess.uid, actor_user_id: sess.uid })
      .eq("feedback_id", inserted.id)
      .is("actor_user_id", null);
  }

  // Notify the auto-assigned admin. Never blocks the response: createNotification
  // swallows its own errors, same as resolveAssignedAdmin above.
  if (assignedTo && inserted) {
    await createNotification(supabase, {
      recipientUserId: assignedTo,
      feedbackId: inserted.id,
      type: "feedback.assigned_to_admin",
      title: `Нова заявка: ${category.title}`,
      body: storeName
        ? `Магазин ${storeName} створив нову заявку.`
        : "Створено нову заявку.",
      payload: { status: "new", category: category.id, store_id: effectiveStoreId, store_name: storeName },
    });
  }

  return NextResponse.json({ ok: true, persisted: true });
}

/**
 * GET /api/feedback
 * Admin-only (middleware enforces role === "admin").
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("feedback_feed")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("feedback_feed error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  if (format === "csv") {
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const headers = [
      "created_at",
      "category_title",
      "store_name",
      "tg_display_name",
      "tg_username",
      "tg_verified",
      "status",
      "summary",
      "photo_url",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        headers
          .map((h) => csvCell(r[h]))
          .join(","),
      );
    }
    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="feedback.csv"',
      },
    });
  }

  return NextResponse.json({ rows: data });
}

/**
 * Escape CSV cell *and* neutralise spreadsheet formula injection
 * (Excel/LibreOffice treat cells starting with =, +, -, @ as formulas).
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  s = s.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

async function sanitizeAndUploadPhoto(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  raw: string,
): Promise<string | null> {
  // Only accept base64 data URLs for whitelisted image mimes.
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

  const ext =
    mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("feedback-photos")
    .upload(path, buf, { contentType: mime, upsert: false });
  if (error) {
    console.warn("photo upload failed", { code: (error as { statusCode?: string }).statusCode });
    return null;
  }

  // Return the storage path (not a public URL). The admin UI resolves this
  // to a short-lived signed URL at render time (see src/app/admin/page.tsx).
  return `sb:${path}`;
}
