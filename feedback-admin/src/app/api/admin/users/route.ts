import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AdminUserRow {
  id: string;
  full_name: string;
  display_label: string | null;
  role: "seller" | "admin" | "super_admin";
  store_id: number | null;
  store_name: string | null;
  is_active: boolean;
  has_pin: boolean;
  failed_attempts: number;
  locked_until: string | null;
  last_login: string | null;
  last_login_country: string | null;
  last_login_city: string | null;
  last_login_asn: string | null;
  last_login_isp: string | null;
}

/**
 * GET /api/admin/users
 * Admin-only. Returns the full user list.
 */
export async function GET() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ users: [] });
  }

  const [{ data: userRows, error: userErr }, { data: storeRows }] = await Promise.all([
    supabase
      .from("users")
      .select(
        "id, full_name, display_label, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login, last_login_country, last_login_city, last_login_asn, last_login_isp",
      )
      .order("full_name", { ascending: true }),
    supabase.from("v_stores").select("id, name"),
  ]);

  if (userErr) {
    console.error("admin list users error", { code: userErr.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const storeMap = new Map<number, string>();
  for (const s of (storeRows ?? []) as Array<{ id: number; name: string }>) {
    storeMap.set(s.id, s.name);
  }

  const rawRows = (userRows ?? []) as Array<{
    id: string;
    full_name: string;
    display_label: string | null;
    role: "seller" | "admin" | "super_admin";
    store_id: number | null;
    is_active: boolean;
    pin_hash: string | null;
    failed_attempts: number | null;
    locked_until: string | null;
    last_login: string | null;
    last_login_country: string | null;
    last_login_city: string | null;
    last_login_asn: string | null;
    last_login_isp: string | null;
  }>;

  const rows = sess.role === "admin" ? rawRows.filter((r) => r.role !== "super_admin") : rawRows;

  const users: AdminUserRow[] = rows.map((u) => ({
    id: u.id,
    full_name: u.full_name,
    display_label: u.display_label,
    role: u.role,
    store_id: u.store_id,
    store_name: u.store_id != null ? storeMap.get(u.store_id) ?? null : null,
    is_active: u.is_active,
    has_pin: u.pin_hash != null,
    failed_attempts: u.failed_attempts ?? 0,
    locked_until: u.locked_until,
    last_login: u.last_login,
    last_login_country: u.last_login_country,
    last_login_city: u.last_login_city,
    last_login_asn: u.last_login_asn,
    last_login_isp: u.last_login_isp,
  }));

  return NextResponse.json({ users });
}

/**
 * POST /api/admin/users
 * Admin-only. Creates a new user card.
 */
export async function POST(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = (body.full_name ?? "").trim();
  const displayLabel = (body.display_label ?? "").trim();
  const role = body.role;
  let storeId = body.store_id;
  const pin = (body.pin ?? "").trim();

  // 1. Validations
  if (!fullName || fullName.length < 2 || fullName.length > 100) {
    return NextResponse.json(
      { error: "ФІО має містити від 2 до 100 символів" },
      { status: 400 },
    );
  }

  if (!displayLabel || displayLabel.length < 2 || displayLabel.length > 100) {
    return NextResponse.json(
      { error: "Відображуване ім'я має містити від 2 до 100 символів" },
      { status: 400 },
    );
  }

  if (pin) {
    const PIN_RE = /^\d{6}$/;
    if (!PIN_RE.test(pin)) {
      return NextResponse.json(
        { error: "PIN-код має складатися рівно з 6 цифр" },
        { status: 400 },
      );
    }
  }

  if (!["seller", "admin", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Недійсна роль" }, { status: 400 });
  }

  // 2. RBAC check (admin can only create sellers)
  if (sess.role === "admin" && role !== "seller") {
    return NextResponse.json(
      { error: "Адміністратори можуть створювати лише продавчинь" },
      { status: 403 },
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  let storeName: string | null = null;

  if (role === "seller") {
    if (storeId == null) {
      return NextResponse.json(
        { error: "Продавчиня обов'язково повинна бути прикріплена до магазину" },
        { status: 400 },
      );
    }
    // Validate store exists in v_stores
    const { data: store, error: storeErr } = await supabase
      .from("v_stores")
      .select("name")
      .eq("id", storeId)
      .maybeSingle();

    if (storeErr || !store) {
      return NextResponse.json({ error: "Магазин не знайдено" }, { status: 400 });
    }
    storeName = store.name;
  } else {
    // Admin / Super Admin cannot be bound to a store
    storeId = null;
  }

  // 3. Insert into DB
  const { data: newUser, error: insertErr } = await supabase
    .from("users")
    .insert({
      full_name: fullName,
      display_label: displayLabel,
      role,
      store_id: storeId,
      is_active: true,
    })
    .select(
      "id, full_name, display_label, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login, last_login_country, last_login_city, last_login_asn, last_login_isp",
    )
    .single();

  if (insertErr) {
    console.error("admin create user error", { code: insertErr.code });
    return NextResponse.json({ error: "Помилка при створенні користувача" }, { status: 500 });
  }

  // 3.5. Set PIN if provided
  if (pin) {
    const { error: pinErr } = await supabase.rpc("set_user_pin", {
      p_user_id: newUser.id,
      p_pin: pin,
    });

    if (pinErr) {
      console.error("admin create user set_user_pin error", { code: pinErr.code, message: pinErr.message });
      // Rollback the created user
      await supabase.from("users").delete().eq("id", newUser.id);
      const msg = pinErr.message?.includes("collision")
        ? "Цей PIN-код вже використовується іншим користувачем"
        : "Не вдалося встановити PIN-код";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // 4. Log Audit Event
  await logAudit("admin.user.create", {
    actorUserId: sess.uid,
    targetUserId: newUser.id,
    targetType: "user",
    meta: {
      full_name: newUser.full_name,
      display_label: newUser.display_label,
      role: newUser.role,
      store_id: newUser.store_id,
    },
  });

  const responseUser: AdminUserRow = {
    id: newUser.id,
    full_name: newUser.full_name,
    display_label: newUser.display_label,
    role: newUser.role,
    store_id: newUser.store_id,
    store_name: storeName,
    is_active: newUser.is_active,
    has_pin: pin ? true : newUser.pin_hash != null,
    failed_attempts: newUser.failed_attempts ?? 0,
    locked_until: newUser.locked_until,
    last_login: newUser.last_login,
    last_login_country: newUser.last_login_country,
    last_login_city: newUser.last_login_city,
    last_login_asn: newUser.last_login_asn,
    last_login_isp: newUser.last_login_isp,
  };

  return NextResponse.json({ user: responseUser });
}
