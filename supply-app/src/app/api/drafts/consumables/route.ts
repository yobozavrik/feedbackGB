import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import {
  deleteConsumablesDraft,
  getOrCreateConsumablesDraft,
  updateConsumablesDraft,
  type DraftCartItem,
} from "@/lib/draftsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 100;
const MAX_COMMENT = 4000;

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function GET() {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const draft = await getOrCreateConsumablesDraft(user.id, user.facilityId);
  if (!draft) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ draft });
}

export async function PATCH(request: Request) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { cart_items?: unknown; comment?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("bad_json");
  }

  const patch: { cart_items?: DraftCartItem[]; comment?: string | null } = {};

  if (body.cart_items !== undefined) {
    if (!Array.isArray(body.cart_items)) return badRequest("cart_items_not_array");
    if (body.cart_items.length > MAX_ITEMS) return badRequest("too_many_items");
    const seen = new Set<number>();
    const items: DraftCartItem[] = [];
    for (const raw of body.cart_items) {
      if (!raw || typeof raw !== "object") return badRequest("bad_cart_item");
      const r = raw as Record<string, unknown>;
      const pid = Number(r.product_id);
      const qty = Number(r.quantity);
      if (!Number.isInteger(pid) || pid <= 0) return badRequest("bad_product_id");
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) return badRequest("bad_quantity");
      if (seen.has(pid)) return badRequest("duplicate_product");
      seen.add(pid);
      items.push({
        product_id: pid,
        quantity: Math.round(qty * 1000) / 1000,
        name: typeof r.name === "string" ? r.name.slice(0, 200) : undefined,
        unit: typeof r.unit === "string" ? r.unit.slice(0, 30) : null,
        photo_url: typeof r.photo_url === "string" ? r.photo_url.slice(0, 500) : null,
      });
    }
    patch.cart_items = items;
  }

  if (body.comment !== undefined) {
    if (body.comment === null || body.comment === "") {
      patch.comment = null;
    } else if (typeof body.comment === "string" && body.comment.length <= MAX_COMMENT) {
      patch.comment = body.comment;
    } else {
      return badRequest("bad_comment");
    }
  }

  const draft = await updateConsumablesDraft(user.id, patch);
  if (!draft) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ draft });
}

export async function DELETE() {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const ok = await deleteConsumablesDraft(user.id);
  if (!ok) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
