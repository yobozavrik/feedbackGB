import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { logAudit } from "@/lib/audit";
import { getServerSupabase } from "@/lib/supabase";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalidUserId(id: string) {
  return !isUuid(id)
    ? NextResponse.json({ error: "Недійсний UUID користувача" }, { status: 400 })
    : null;
}

async function requireSeller(id: string) {
  const supabase = getServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: "db_error" }, { status: 500 }) };
  const { data, error } = await supabase.from("users").select("id, role").eq("id", id).maybeSingle();
  if (error) return { error: NextResponse.json({ error: "db_error" }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 }) };
  if (data.role !== "seller") return { error: NextResponse.json({ error: "Магазини для заміни доступні лише продавчиням" }, { status: 400 }) };
  return { supabase };
}

async function parseStoreId(req: Request) {
  try {
    const body = await req.json() as { store_id?: unknown };
    return typeof body.store_id === "number" && Number.isInteger(body.store_id) && body.store_id > 0
      ? body.store_id
      : null;
  } catch {
    return null;
  }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const invalid = invalidUserId(params.id);
  if (invalid) return invalid;
  if (!await requireAdminSession()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const seller = await requireSeller(params.id);
  if (seller.error) return seller.error;
  const { data, error } = await seller.supabase
    .from("seller_store_permissions")
    .select("id, store_id, granted_at, granted_by, revoked_at, revoked_by")
    .eq("seller_id", params.id)
    .order("granted_at", { ascending: false });
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  return NextResponse.json({ permissions: data ?? [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const invalid = invalidUserId(params.id);
  if (invalid) return invalid;
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const storeId = await parseStoreId(req);
  if (storeId == null) return NextResponse.json({ error: "Недійсний магазин" }, { status: 400 });
  const seller = await requireSeller(params.id);
  if (seller.error) return seller.error;
  const { data: store } = await seller.supabase.from("v_stores").select("id").eq("id", storeId).maybeSingle();
  if (!store) return NextResponse.json({ error: "Магазин не знайдено" }, { status: 400 });
  const { data, error } = await seller.supabase
    .from("seller_store_permissions")
    .insert({ seller_id: params.id, store_id: storeId, granted_by: session.uid })
    .select("id, store_id, granted_at, granted_by, revoked_at, revoked_by")
    .single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Доступ до магазину вже активний" : "db_error" }, { status: error.code === "23505" ? 409 : 500 });
  await logAudit("admin.user.replacement_store.grant", { actorUserId: session.uid, targetUserId: params.id, targetType: "user", meta: { store_id: storeId, permission_id: data.id } });
  return NextResponse.json({ permission: data });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const invalid = invalidUserId(params.id);
  if (invalid) return invalid;
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const storeId = await parseStoreId(req);
  if (storeId == null) return NextResponse.json({ error: "Недійсний магазин" }, { status: 400 });
  const seller = await requireSeller(params.id);
  if (seller.error) return seller.error;
  const { data, error } = await seller.supabase
    .from("seller_store_permissions")
    .update({ revoked_at: new Date().toISOString(), revoked_by: session.uid })
    .eq("seller_id", params.id)
    .eq("store_id", storeId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Активний доступ не знайдено" }, { status: 404 });
  await logAudit("admin.user.replacement_store.revoke", { actorUserId: session.uid, targetUserId: params.id, targetType: "user", meta: { store_id: storeId, permission_id: data.id } });
  return NextResponse.json({ ok: true });
}
