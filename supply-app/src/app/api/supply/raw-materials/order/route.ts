import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getWorkshopIdForFacility, getZakupkiEmployeeId } from "@/lib/zakupkiWorkshop";
import { getZakupkiSupabase } from "@/lib/zakupkiDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 100;
const MAX_COMMENT = 4000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RawItem {
  ingredient_id?: unknown;
  quantity?: unknown;
}

/**
 * POST /api/supply/raw-materials/order — creates a zakupki.requests row
 * (type='raw_material') + zakupki.request_items. Writes into the existing
 * zakupki procurement schema (not a parallel feedbackgb table) so every
 * workshop/store/warehouse's raw-material orders live in one history
 * alongside whatever else zakupki.requests already tracks.
 *
 * Item name/unit are re-resolved server-side from the caller's own workshop
 * catalog — never trusted from the client — both for tamper-resistance and to
 * reject ingredients outside the caller's workshop. employee_id is resolved
 * via zakupki.employees.feedbackgb_user_id, set by hand by a super_admin
 * (see 20260725_001_zakupki_supply_app_bridge.sql) — no auto-provisioning.
 */
export async function POST(request: Request) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.facilityId) {
    return NextResponse.json({ error: "Твій цех/склад не прив'язано" }, { status: 400 });
  }

  let body: { items?: unknown; comment?: unknown; client_submission_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некоректний запит" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "Кошик порожній" }, { status: 400 });
  }
  if (body.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Забагато позицій: максимум ${MAX_ITEMS}` }, { status: 400 });
  }

  const seen = new Set<string>();
  const requested: Array<{ ingredientId: string; quantity: number }> = [];
  for (const raw of body.items as RawItem[]) {
    const id = raw?.ingredient_id;
    const qty = raw?.quantity;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Некоректна позиція кошика" }, { status: 400 });
    }
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
      return NextResponse.json({ error: "Некоректна кількість" }, { status: 400 });
    }
    if (seen.has(id)) {
      return NextResponse.json({ error: "Одна позиція не може бути в кошику двічі" }, { status: 400 });
    }
    seen.add(id);
    requested.push({ ingredientId: id, quantity: Math.round(qty * 1000) / 1000 });
  }

  const comment =
    typeof body.comment === "string" && body.comment.trim() && body.comment.length <= MAX_COMMENT
      ? body.comment.trim()
      : null;

  let clientSubmissionId: string | null = null;
  if (body.client_submission_id !== undefined && body.client_submission_id !== null) {
    if (typeof body.client_submission_id !== "string" || !UUID_REGEX.test(body.client_submission_id)) {
      return NextResponse.json({ error: "Invalid client_submission_id" }, { status: 400 });
    }
    clientSubmissionId = body.client_submission_id;
  }

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

  const { data: catalogRows, error: catalogErr } = await zakupki
    .from("workshop_ingredient_catalog")
    .select("ingredient_id, ingredients(name_uk, unit)")
    .eq("workshop_id", workshopId)
    .eq("is_active", true)
    .in(
      "ingredient_id",
      requested.map((r) => r.ingredientId),
    );
  if (catalogErr) {
    console.error("[supply] raw-materials order catalog lookup", { code: catalogErr.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
  const catalogById = new Map(
    ((catalogRows ?? []) as unknown as Array<{
      ingredient_id: string;
      ingredients: { name_uk: string; unit: string } | null;
    }>)
      .filter((r) => r.ingredients)
      .map((r) => [r.ingredient_id, r.ingredients!]),
  );

  const items: Array<{ ingredient_id: string; item_name: string; unit: string; quantity: number }> = [];
  for (const r of requested) {
    const ingredient = catalogById.get(r.ingredientId);
    if (!ingredient) {
      return NextResponse.json({ error: "Один із товарів недоступний у твоєму цеху" }, { status: 400 });
    }
    items.push({
      ingredient_id: r.ingredientId,
      item_name: ingredient.name_uk,
      unit: ingredient.unit,
      quantity: r.quantity,
    });
  }

  const { data: inserted, error } = await zakupki
    .from("requests")
    .insert({
      workshop_id: workshopId,
      employee_id: employeeId,
      type: "raw_material",
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
    console.error("[supply] raw-materials order insert", { code: error.code });
    return NextResponse.json({ error: "Помилка збереження" }, { status: 500 });
  }

  const requestId = (inserted as { id: string }).id;
  const { error: itemsErr } = await zakupki
    .from("request_items")
    .insert(items.map((i) => ({ ...i, request_id: requestId })));
  if (itemsErr) {
    console.error("[supply] raw-materials order items insert", { code: itemsErr.code });
    // The request row exists but items failed — surface an error rather than
    // silently leaving an empty order; the client_submission_id retry path
    // above lets a resubmit be recognised as the same request.
    return NextResponse.json({ error: "Помилка збереження позицій" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: requestId });
}
