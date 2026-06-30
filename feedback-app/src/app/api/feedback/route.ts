import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCategory, type CategoryId, CATEGORIES } from "@/lib/categories";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { buildSummary } from "@/lib/summary";
import { validateInitData } from "@/lib/telegram";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import type { FeedbackPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const MAX_BODY_BYTES = 8 * 1024 * 1024; // enough for several compressed photos
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB decoded
const MAX_PHOTOS = 5;
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FIELD_LEN = 4000;
const MAX_FIELDS = 40;
const MAX_STORE_LABEL_LEN = 80;

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

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!payload.category || !VALID_CATEGORY_IDS.has(payload.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  const category = getCategory(payload.category)!;

  // Required-field check + shape / length validation.
  const cleanFields: Record<string, string | number | null> = {};
  const incomingFields = (payload.fields ?? {}) as Record<string, unknown>;
  if (typeof incomingFields !== "object" || Array.isArray(incomingFields)) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  const fieldKeys = Object.keys(incomingFields);
  if (fieldKeys.length > MAX_FIELDS) {
    return NextResponse.json({ error: "Too many fields" }, { status: 400 });
  }
  for (const key of fieldKeys) {
    const v = incomingFields[key];
    if (v === null || v === undefined) {
      cleanFields[key] = null;
      continue;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        return NextResponse.json(
          { error: `Invalid number: ${key}` },
          { status: 400 },
        );
      }
      cleanFields[key] = v;
      continue;
    }
    if (typeof v === "string") {
      if (v.length > MAX_FIELD_LEN) {
        return NextResponse.json(
          { error: `Field too long: ${key}` },
          { status: 400 },
        );
      }
      cleanFields[key] = v;
      continue;
    }
    return NextResponse.json(
      { error: `Invalid field type: ${key}` },
      { status: 400 },
    );
  }

  for (const f of category.fields) {
    if (f.kind === "photo" || !f.required) continue;
    const v = cleanFields[f.id];
    if (v === undefined || v === null || `${v}`.trim() === "") {
      return NextResponse.json(
        { error: `Missing required field: ${f.id}` },
        { status: 400 },
      );
    }
  }

  const storeLabel =
    typeof payload.store_label === "string" && payload.store_label.trim()
      ? payload.store_label.trim().slice(0, MAX_STORE_LABEL_LEN)
      : null;

  // v1 priority flow: structured product reference + quantity.
  // product_id is a bigint PK from categories.products; we accept any positive
  // integer and let Postgres reject unknown FKs.
  const productId =
    typeof payload.product_id === "number" &&
    Number.isFinite(payload.product_id) &&
    payload.product_id > 0 &&
    Number.isInteger(payload.product_id)
      ? payload.product_id
      : null;

  const quantity =
    typeof payload.quantity === "number" &&
    Number.isFinite(payload.quantity) &&
    payload.quantity >= 0 &&
    payload.quantity <= 1_000_000
      ? payload.quantity
      : null;

  // v1 priority categories: new product-picker UI submits
  //   { product_id, quantity, fields: { comment?, photo? } }
  // while the legacy UI still submits { fields: { item_name, ... } }.
  // We accept either shape, but when product_id is set (modern flow)
  // we require a positive quantity to keep data clean.
  if (category.requiresProduct) {
    const itemName =
      typeof cleanFields["item_name"] === "string"
        ? (cleanFields["item_name"] as string).trim()
        : "";
    if (!productId && !itemName) {
      return NextResponse.json(
        { error: "Обери товар або введи назву" },
        { status: 400 },
      );
    }
  }
  if (productId !== null && category.requiresQuantity) {
    if (quantity === null || quantity <= 0) {
      return NextResponse.json(
        { error: "Вкажи кількість" },
        { status: 400 },
      );
    }
  }

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

  // photo handling: accept ONLY a base64 data: URL for a whitelisted image
  // mime. Anything else (arbitrary http(s):// URLs, javascript:, data: with
  // non-image mime, oversized) is dropped — never stored.
  let photoUrl: string | null = null;
  let photoUrls: string[] = [];
  const incomingPhotos = Array.isArray(payload.photo_urls)
    ? payload.photo_urls
    : typeof payload.photo_url === "string"
      ? [payload.photo_url]
      : [];
  if (incomingPhotos.length > MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Too many photos: max ${MAX_PHOTOS}` },
      { status: 400 },
    );
  }
  if (supabase && incomingPhotos.length > 0) {
    for (const rawPhoto of incomingPhotos) {
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

  const record = {
    category: payload.category as CategoryId,
    store_id: effectiveStoreId,
    store_label: storeLabel,
    user_id: sess.uid,
    product_id: productId,
    quantity: quantity,
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
  };

  if (!isSupabaseConfigured() || !supabase) {
    // Do NOT log PII — just report that the backend isn't configured.
    console.warn("[feedback] Supabase not configured; record dropped");
    return NextResponse.json({ ok: true, persisted: false });
  }

  // Tell the DB audit trigger who the actor is, so audit_log isn't
  // permanently stamped with "service_role".
  try {
    await supabase.rpc("set_config", {
      setting_name: "app.actor",
      new_value: sess.uid,
      is_local: true,
    });
  } catch {
    // Non-fatal: audit trigger falls back to 'service_role'.
  }

  const { error } = await supabase.from("feedback").insert(record);
  if (error) {
    console.error("supabase insert error", { code: error.code });
    return NextResponse.json({ error: "Помилка збереження" }, { status: 500 });
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
