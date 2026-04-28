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

const VALID_CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export async function POST(req: Request) {
  let payload: FeedbackPayload;
  try {
    payload = (await req.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.category || !VALID_CATEGORY_IDS.has(payload.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  const category = getCategory(payload.category)!;

  for (const f of category.fields) {
    if (f.kind === "photo" || !f.required) continue;
    const v = payload.fields?.[f.id];
    if (v === undefined || v === null || `${v}`.trim() === "") {
      return NextResponse.json(
        { error: `Missing required field: ${f.id}` },
        { status: 400 },
      );
    }
  }

  // Auth: prefer PIN session; Telegram initData is optional/secondary.
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);

  const { user, valid } = validateInitData(
    payload.init_data,
    process.env.TELEGRAM_BOT_TOKEN,
  );

  const display =
    sess?.full_name ||
    (user
      ? [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
        user.username ||
        null
      : null);

  const verified = valid;

  // For sellers we ignore client-provided store_id and trust the session.
  const effectiveStoreId =
    sess?.role === "seller" && sess.store_id != null
      ? sess.store_id
      : (payload.store_id ?? null);

  let photoUrl: string | null = payload.photo_url ?? null;
  const supabase = getServerSupabase();

  // If we got a base64 data URL and Supabase Storage is available, upload it
  // and replace with public URL. Otherwise we keep the data URL inline.
  if (supabase && photoUrl && photoUrl.startsWith("data:image/")) {
    try {
      photoUrl = await uploadPhoto(supabase, photoUrl);
    } catch (e) {
      console.warn("Photo upload failed, keeping data URL", e);
    }
  }

  // Resolve store name for the summary string (best-effort).
  let storeName: string | null = null;
  if (supabase && effectiveStoreId) {
    const { data } = await supabase
      .from("v_stores")
      .select("name")
      .eq("id", effectiveStoreId)
      .maybeSingle();
    storeName = (data as { name: string } | null)?.name ?? null;
  }

  const summary = buildSummary(
    { ...payload, store_id: effectiveStoreId, photo_url: photoUrl },
    {
      display_name: display,
      username: user?.username ?? null,
    },
    storeName,
  );

  const record = {
    category: payload.category as CategoryId,
    store_id: effectiveStoreId,
    store_label: payload.store_label?.trim() || null,
    user_id: sess?.uid ?? null,
    fields: payload.fields ?? {},
    photo_url: photoUrl,
    tg_user_id: user?.id ?? null,
    tg_username: user?.username ?? null,
    tg_display_name: display,
    tg_verified: verified,
    summary,
  };

  if (!isSupabaseConfigured() || !supabase) {
    console.info("[feedback] (no Supabase) ", JSON.stringify(record));
    return NextResponse.json({ ok: true, persisted: false });
  }

  const { error } = await supabase.from("feedback").insert(record);
  if (error) {
    console.error("supabase insert error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, persisted: true });
}

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
          .map((h) => {
            const v = r[h];
            if (v === null || v === undefined) return "";
            const s = String(v).replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          })
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

async function uploadPhoto(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  dataUrl: string,
): Promise<string> {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Bad data URL");
  const mime = match[1];
  const ext = mime.split("/")[1] ?? "jpg";
  const buf = Buffer.from(match[2], "base64");
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("feedback-photos")
    .upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabase.storage.from("feedback-photos").getPublicUrl(path);
  return data.publicUrl;
}
