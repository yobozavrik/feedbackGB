import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { isAdminTier } from "@/lib/session";
import { logAudit, ipFromRequest, uaFromRequest } from "@/lib/audit";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  admin_id?: string;
  category?: string;
  store_id?: number | null;
  is_active?: boolean;
}

/**
 * PATCH /api/admin/directions/<uuid>
 *   { admin_id?, category?, store_id?, is_active? }
 *
 * super_admin-only. Edits a responsibility rule, or soft-deletes it via
 * `is_active: false` (per plan: deletion is soft-delete, no DELETE verb).
 *
 * Several different admins may share a (category, store-scope), but the
 * same admin can't have two active rules for it (016_admin_directions_
 * allow_multiple.sql). A duplicate surfaces as Postgres 23505, translated
 * to 409 here — same handling as the create endpoint.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await requireAdminSession("super_admin");
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { data: existing, error: lookupError } = await supabase
    .from("admin_directions")
    .select("id, is_active")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) {
    console.error("admin_directions lookup error", { code: lookupError.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body.admin_id !== undefined) {
    if (!isUuid(body.admin_id)) {
      return NextResponse.json({ error: "bad_admin_id" }, { status: 400 });
    }
    const { data: adminRow } = await supabase
      .from("users")
      .select("id, role, is_active")
      .eq("id", body.admin_id)
      .maybeSingle();
    if (!adminRow || !isAdminTier(adminRow.role as "seller" | "admin" | "super_admin") || !adminRow.is_active) {
      return NextResponse.json({ error: "bad_admin_id" }, { status: 400 });
    }
    update.admin_id = body.admin_id;
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || body.category.length === 0) {
      return NextResponse.json({ error: "bad_category" }, { status: 400 });
    }
    const { data: categoryRow } = await supabase
      .from("categories")
      .select("id")
      .eq("id", body.category)
      .maybeSingle();
    if (!categoryRow) {
      return NextResponse.json({ error: "bad_category" }, { status: 400 });
    }
    update.category = body.category;
  }

  if (body.store_id !== undefined) {
    if (body.store_id !== null) {
      if (typeof body.store_id !== "number" || !Number.isFinite(body.store_id)) {
        return NextResponse.json({ error: "bad_store_id" }, { status: 400 });
      }
      const { data: storeRow } = await supabase
        .from("v_stores")
        .select("id")
        .eq("id", body.store_id)
        .maybeSingle();
      if (!storeRow) {
        return NextResponse.json({ error: "bad_store_id" }, { status: 400 });
      }
    }
    update.store_id = body.store_id;
  }

  if (body.is_active !== undefined) {
    update.is_active = body.is_active;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from("admin_directions")
    .update(update)
    .eq("id", id);

  if (updateErr) {
    if (updateErr.code === "23505") {
      return NextResponse.json(
        {
          error: "scope_conflict",
          message:
            "Цей адмін вже має активне правило для обраної категорії та магазину (чи «всіх магазинів») — відредагуй або деактивуй існуюче замість дублювання.",
        },
        { status: 409 },
      );
    }
    console.error("admin_directions update error", { code: updateErr.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const isDeactivation = body.is_active === false && existing.is_active === true;
  await logAudit(isDeactivation ? "admin.direction.deactivate" : "admin.direction.update", {
    actorUserId: sess.uid,
    targetType: "admin_direction",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: { direction_id: id, changed: Object.keys(update) },
  });

  return NextResponse.json({ ok: true });
}
