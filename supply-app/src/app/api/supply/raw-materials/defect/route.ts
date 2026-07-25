import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getServerSupabase } from "@/lib/supabase";
import { getWorkshopIdForFacility, getZakupkiEmployeeId } from "@/lib/zakupkiWorkshop";
import { getZakupkiSupabase } from "@/lib/zakupkiDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COMMENT = 4000;
const MAX_DEFECT_TYPE = 120;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/supply/raw-materials/defect — creates a zakupki.requests row
 * (type='raw_material_defect') + one zakupki.request_items row + attachments.
 * Mirrors /order (same workshop/employee bridge, same server-side item
 * resolution) so raw-material orders and defects share one history in
 * zakupki.requests instead of living in two different schemas.
 */
export async function POST(request: Request) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.facilityId) {
    return NextResponse.json({ error: "Твій цех/склад не прив'язано" }, { status: 400 });
  }

  let body: {
    ingredient_id?: unknown;
    quantity?: unknown;
    defect_type?: unknown;
    comment?: unknown;
    photo_urls?: unknown;
    client_submission_id?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некоректний запит" }, { status: 400 });
  }

  if (typeof body.ingredient_id !== "string" || !UUID_REGEX.test(body.ingredient_id)) {
    return NextResponse.json({ error: "Обери інгредієнт" }, { status: 400 });
  }
  const quantity = body.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
    return NextResponse.json({ error: "Некоректна кількість" }, { status: 400 });
  }
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!comment) {
    return NextResponse.json({ error: "Опиши, що саме не так" }, { status: 400 });
  }
  if (comment.length > MAX_COMMENT) {
    return NextResponse.json({ error: "Занадто довгий опис" }, { status: 400 });
  }
  const defectType =
    typeof body.defect_type === "string" && body.defect_type.trim()
      ? body.defect_type.trim().slice(0, MAX_DEFECT_TYPE)
      : null;

  let clientSubmissionId: string | null = null;
  if (body.client_submission_id !== undefined && body.client_submission_id !== null) {
    if (typeof body.client_submission_id !== "string" || !UUID_REGEX.test(body.client_submission_id)) {
      return NextResponse.json({ error: "Invalid client_submission_id" }, { status: 400 });
    }
    clientSubmissionId = body.client_submission_id;
  }

  const rawPhotos = Array.isArray(body.photo_urls) ? body.photo_urls.slice(0, MAX_PHOTOS) : [];

  const workshopId = await getWorkshopIdForFacility(user.facilityId);
  if (!workshopId) {
    return NextResponse.json(
      { error: "Твій цех/склад не має каталогу сировини. Зверніться до супер-адміністратора." },
      { status: 400 },
    );
  }
  const employeeId = await getZakupkiEmployeeId(workshopId, user.id);
  if (!employeeId) {
    return NextResponse.json(
      {
        error:
          "Твій обліковий запис ще не підключено до системи закупівель. Зверніться до супер-адміністратора.",
      },
      { status: 400 },
    );
  }

  const zakupki = getZakupkiSupabase();
  if (!zakupki) return NextResponse.json({ error: "Сервіс недоступний" }, { status: 503 });

  const { data: catalogRow, error: catalogErr } = await zakupki
    .from("workshop_ingredient_catalog")
    .select("ingredient_id, ingredients(name_uk, unit)")
    .eq("workshop_id", workshopId)
    .eq("ingredient_id", body.ingredient_id)
    .eq("is_active", true)
    .maybeSingle();
  if (catalogErr) {
    console.error("[supply] raw-materials defect catalog lookup", { code: catalogErr.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
  const ingredient = (catalogRow as { ingredients: { name_uk: string; unit: string } | null } | null)?.ingredients;
  if (!ingredient) {
    return NextResponse.json({ error: "Інгредієнт недоступний у твоєму цеху" }, { status: 400 });
  }

  const { data: inserted, error } = await zakupki
    .from("requests")
    .insert({
      workshop_id: workshopId,
      employee_id: employeeId,
      type: "raw_material_defect",
      defect_reason: defectType,
      comment,
      client_submission_id: clientSubmissionId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" && clientSubmissionId) {
      const { data: existing } = await zakupki
        .from("requests")
        .select("id, employee_id")
        .eq("client_submission_id", clientSubmissionId)
        .maybeSingle();
      if (existing && (existing as { employee_id: string }).employee_id === employeeId) {
        return NextResponse.json({ ok: true, id: (existing as { id: string }).id, duplicate: true });
      }
    }
    console.error("[supply] raw-materials defect insert", { code: error.code });
    return NextResponse.json({ error: "Помилка збереження" }, { status: 500 });
  }

  const requestId = (inserted as { id: string }).id;
  const { error: itemErr } = await zakupki.from("request_items").insert({
    request_id: requestId,
    ingredient_id: body.ingredient_id,
    item_name: ingredient.name_uk,
    quantity,
    unit: ingredient.unit,
  });
  if (itemErr) {
    console.error("[supply] raw-materials defect item insert", { code: itemErr.code });
    return NextResponse.json({ error: "Помилка збереження позиції" }, { status: 500 });
  }

  if (rawPhotos.length > 0) {
    const supabase = getServerSupabase();
    if (supabase) {
      const attachments: Array<{ request_id: string; storage_path: string; mime_type: string; file_size: number }> =
        [];
      for (const raw of rawPhotos) {
        if (typeof raw !== "string") continue;
        const uploaded = await sanitizeAndUploadPhoto(supabase, raw);
        if (uploaded) attachments.push({ request_id: requestId, ...uploaded });
      }
      if (attachments.length > 0) {
        const { error: attachErr } = await zakupki.from("request_attachments").insert(attachments);
        if (attachErr) {
          // Photos are supporting evidence, not the record of truth — the
          // request itself already saved successfully, so don't fail the
          // whole submission over an attachment write.
          console.error("[supply] raw-materials defect attachments insert", { code: attachErr.code });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, id: requestId });
}

async function sanitizeAndUploadPhoto(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  raw: string,
): Promise<{ storage_path: string; mime_type: string; file_size: number } | null> {
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
    console.warn("[supply] defect photo upload failed");
    return null;
  }
  // No bucket column on request_attachments — prefix so a future reader
  // knows unambiguously which bucket to sign against.
  return { storage_path: `feedback-photos/${path}`, mime_type: mime, file_size: buf.length };
}
