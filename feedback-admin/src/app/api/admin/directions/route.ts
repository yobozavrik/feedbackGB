import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { isAdminTier } from "@/lib/session";
import { logAudit, ipFromRequest, uaFromRequest } from "@/lib/audit";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminDirectionRow {
  id: string;
  admin_id: string;
  admin_full_name: string | null;
  category: string;
  category_title: string | null;
  store_id: number | null;
  store_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface RawDirectionRow {
  id: string;
  admin_id: string;
  category: string;
  store_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/admin/directions
 * Admin-tier read (both `admin` and `super_admin` can view — matches the
 * plan's "regular admins can view their own responsibilities read-only").
 * Writes (POST here, PATCH on /[id]) are super_admin-only.
 */
export async function GET() {
  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ directions: [] });
  }

  const [{ data: rows, error }, { data: admins }, { data: categories }, { data: stores }] =
    await Promise.all([
      supabase
        .from("admin_directions")
        .select("id, admin_id, category, store_id, is_active, created_at, updated_at")
        .order("category", { ascending: true }),
      supabase.from("users").select("id, full_name"),
      supabase.from("categories").select("id, title"),
      supabase.from("v_stores").select("id, name"),
    ]);

  if (error) {
    console.error("admin_directions list error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const adminNameById = new Map<string, string>();
  for (const a of (admins ?? []) as Array<{ id: string; full_name: string }>) {
    adminNameById.set(a.id, a.full_name);
  }
  const categoryTitleById = new Map<string, string>();
  for (const c of (categories ?? []) as Array<{ id: string; title: string }>) {
    categoryTitleById.set(c.id, c.title);
  }
  const storeNameById = new Map<number, string>();
  for (const s of (stores ?? []) as Array<{ id: number; name: string }>) {
    storeNameById.set(s.id, s.name);
  }

  const directions: AdminDirectionRow[] = ((rows ?? []) as RawDirectionRow[]).map((r) => ({
    id: r.id,
    admin_id: r.admin_id,
    admin_full_name: adminNameById.get(r.admin_id) ?? null,
    category: r.category,
    category_title: categoryTitleById.get(r.category) ?? null,
    store_id: r.store_id,
    store_name: r.store_id != null ? storeNameById.get(r.store_id) ?? null : null,
    is_active: r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return NextResponse.json({ directions });
}

/**
 * POST /api/admin/directions
 * super_admin-only. Creates a responsibility rule: { admin_id, category,
 * store_id? }. `store_id: null`/omitted means "all stores".
 *
 * Several different admins may share the same (category, store-scope) —
 * see 016_admin_directions_allow_multiple.sql — but the same admin cannot
 * have two active rules for the same scope (that would just be a pointless
 * duplicate, and would make resolveAssignedAdmin see it as "2 admins"
 * instead of one). A duplicate insert surfaces as Postgres 23505,
 * translated to 409 here.
 */
export async function POST(req: Request) {
  const sess = await requireAdminSession("super_admin");
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const adminId = body.admin_id;
  const category = body.category;
  const storeId = body.store_id === undefined ? null : body.store_id;

  if (!isUuid(adminId)) {
    return NextResponse.json({ error: "bad_admin_id" }, { status: 400 });
  }
  if (typeof category !== "string" || category.length === 0) {
    return NextResponse.json({ error: "bad_category" }, { status: 400 });
  }
  if (storeId !== null && (typeof storeId !== "number" || !Number.isFinite(storeId))) {
    return NextResponse.json({ error: "bad_store_id" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  // Validate the assignee: must exist, be admin-tier, and active — same
  // defence-in-depth check as manual feedback reassignment
  // (feedback-admin/src/app/api/admin/feedback/[id]/route.ts).
  const { data: adminRow } = await supabase
    .from("users")
    .select("id, role, is_active")
    .eq("id", adminId)
    .maybeSingle();
  if (!adminRow || !isAdminTier(adminRow.role as "seller" | "admin" | "super_admin") || !adminRow.is_active) {
    return NextResponse.json({ error: "bad_admin_id" }, { status: 400 });
  }

  // Validate category against the canonical table (not a hardcoded list —
  // categories.ts / feedbackgb.categories is the single source of truth).
  const { data: categoryRow } = await supabase
    .from("categories")
    .select("id")
    .eq("id", category)
    .maybeSingle();
  if (!categoryRow) {
    return NextResponse.json({ error: "bad_category" }, { status: 400 });
  }

  // Validate store, if scoped.
  if (storeId !== null) {
    const { data: storeRow } = await supabase
      .from("v_stores")
      .select("id")
      .eq("id", storeId)
      .maybeSingle();
    if (!storeRow) {
      return NextResponse.json({ error: "bad_store_id" }, { status: 400 });
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("admin_directions")
    .insert({ admin_id: adminId, category, store_id: storeId })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        {
          error: "scope_conflict",
          message:
            "Цей адмін вже має активне правило для обраної категорії та магазину (чи «всіх магазинів») — відредагуй або деактивуй існуюче замість дублювання.",
        },
        { status: 409 },
      );
    }
    console.error("admin_directions insert error", { code: insertErr.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  await logAudit("admin.direction.create", {
    actorUserId: sess.uid,
    targetUserId: adminId,
    targetType: "admin_direction",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: { direction_id: inserted.id, category, store_id: storeId },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
