import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { isUuid } from "@/lib/validation";

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
 * PATCH /api/admin/users/[id]
 * Updates user profile card fields.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Недійсний UUID користувача" }, { status: 400 });
  }

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

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // 1. Fetch current database state for target user (Database-first RBAC)
  const { data: targetUser, error: fetchErr } = await supabase
    .from("users")
    .select("id, full_name, display_label, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login, last_login_country, last_login_city, last_login_asn, last_login_isp")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    console.error("fetch target user error", { code: fetchErr.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // 2. RBAC checks
  if (sess.role === "admin") {
    // Admin cannot edit admin or super_admin
    if (targetUser.role === "admin" || targetUser.role === "super_admin") {
      return NextResponse.json(
        { error: "Адміністратори не можуть редагувати інших адміністраторів" },
        { status: 403 },
      );
    }
    // Admin cannot change role to admin or super_admin
    if (body.role != null && body.role !== "seller") {
      return NextResponse.json(
        { error: "Адміністратори не можуть видавати адміністративні ролі" },
        { status: 403 },
      );
    }
  }

  // 3. Process inputs
  const fullName = body.full_name !== undefined ? String(body.full_name).trim() : undefined;
  const displayLabel = body.display_label !== undefined ? String(body.display_label).trim() : undefined;
  const role = body.role;
  let storeId = body.store_id;
  const isActive = body.is_active;

  // 4. Validations
  if (fullName !== undefined && (fullName.length < 2 || fullName.length > 100)) {
    return NextResponse.json(
      { error: "ФІО має містити від 2 до 100 символів" },
      { status: 400 },
    );
  }

  if (displayLabel !== undefined && (displayLabel.length < 2 || displayLabel.length > 100)) {
    return NextResponse.json(
      { error: "Відображуване ім'я має містити від 2 до 100 символів" },
      { status: 400 },
    );
  }

  if (role !== undefined && !["seller", "admin", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Недійсна роль" }, { status: 400 });
  }

  const finalRole = role ?? targetUser.role;
  let storeName: string | null = null;

  if (finalRole === "seller") {
    const finalStoreId = storeId !== undefined ? storeId : targetUser.store_id;
    if (finalStoreId == null) {
      return NextResponse.json(
        { error: "Продавчиня обов'язково повинна бути прикріплена до магазину" },
        { status: 400 },
      );
    }

    // Validate store exists in v_stores
    const { data: store, error: storeErr } = await supabase
      .from("v_stores")
      .select("name")
      .eq("id", finalStoreId)
      .maybeSingle();

    if (storeErr || !store) {
      return NextResponse.json({ error: "Магазин не знайдено" }, { status: 400 });
    }
    storeName = store.name;
    storeId = finalStoreId;
  } else {
    // Admin / Super Admin cannot be bound to a store
    storeId = null;
  }

  // 5. Self-modification and super_admin limits
  if (sess.uid === targetUser.id) {
    if (isActive === false) {
      return NextResponse.json(
        { error: "Не можна деактивувати свій власний акаунт" },
        { status: 400 },
      );
    }
    if (role !== undefined && role !== targetUser.role) {
      return NextResponse.json(
        { error: "Не можна змінити свою власну роль" },
        { status: 400 },
      );
    }
  }

  const changingRoleOrStatus =
    (role !== undefined && role !== "super_admin") ||
    (isActive === false);

  if (targetUser.role === "super_admin" && targetUser.is_active && changingRoleOrStatus) {
    // Count active super admins
    const { count, error: countErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);

    if (countErr) {
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    if (count != null && count <= 1) {
      return NextResponse.json(
        { error: "Не можна змінити або деактивувати останнього активного супер-адміністратора" },
        { status: 400 },
      );
    }
  }

  // 6. Update database record
  const updatePayload: any = {};
  if (fullName !== undefined) updatePayload.full_name = fullName;
  if (displayLabel !== undefined) updatePayload.display_label = displayLabel;
  if (role !== undefined) updatePayload.role = role;
  if (storeId !== undefined || finalRole !== "seller") updatePayload.store_id = storeId;
  if (isActive !== undefined) updatePayload.is_active = isActive;

  const { data: updatedUser, error: updateErr } = await supabase
    .from("users")
    .update(updatePayload)
    .eq("id", id)
    .select(
      "id, full_name, display_label, role, store_id, is_active, pin_hash, failed_attempts, locked_until, last_login, last_login_country, last_login_city, last_login_asn, last_login_isp",
    )
    .single();

  if (updateErr) {
    console.error("admin update user error", { code: updateErr.code });
    return NextResponse.json({ error: "Помилка при оновленні користувача" }, { status: 500 });
  }

  // 7. Log Audit Event
  let auditAction: any = "admin.user.update";
  if (isActive !== undefined && isActive !== targetUser.is_active) {
    auditAction = isActive ? "admin.user.activate" : "admin.user.deactivate";
  }

  await logAudit(auditAction, {
    actorUserId: sess.uid,
    targetUserId: updatedUser.id,
    targetType: "user",
    meta: {
      changed: Object.keys(updatePayload),
      role: updatedUser.role,
      is_active: updatedUser.is_active,
    },
  });

  const responseUser: AdminUserRow = {
    id: updatedUser.id,
    full_name: updatedUser.full_name,
    display_label: updatedUser.display_label,
    role: updatedUser.role,
    store_id: updatedUser.store_id,
    store_name: storeName,
    is_active: updatedUser.is_active,
    has_pin: updatedUser.pin_hash != null,
    failed_attempts: updatedUser.failed_attempts ?? 0,
    locked_until: updatedUser.locked_until,
    last_login: updatedUser.last_login,
    last_login_country: updatedUser.last_login_country,
    last_login_city: updatedUser.last_login_city,
    last_login_asn: updatedUser.last_login_asn,
    last_login_isp: updatedUser.last_login_isp,
  };

  return NextResponse.json({ user: responseUser });
}

/**
 * DELETE /api/admin/users/[id]
 * Soft-deactivates the user (is_active = false) to preserve references.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Недійсний UUID користувача" }, { status: 400 });
  }

  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // 1. Fetch current database state
  const { data: targetUser, error: fetchErr } = await supabase
    .from("users")
    .select("id, role, is_active")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // 2. RBAC check
  if (sess.role === "admin" && (targetUser.role === "admin" || targetUser.role === "super_admin")) {
    return NextResponse.json(
      { error: "Адміністратори не можуть деактивувати інших адміністраторів" },
      { status: 403 },
    );
  }

  // 3. Self-deactivation and super_admin limits
  if (sess.uid === targetUser.id) {
    return NextResponse.json(
      { error: "Не можна деактивувати свій власний акаунт" },
      { status: 400 },
    );
  }

  if (targetUser.role === "super_admin" && targetUser.is_active) {
    // Count active super admins
    const { count, error: countErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);

    if (countErr) {
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    if (count != null && count <= 1) {
      return NextResponse.json(
        { error: "Не можна деактивувати останнього активного супер-адміністратора" },
        { status: 400 },
      );
    }
  }

  // 4. Soft-delete in DB
  const { error: updateErr } = await supabase
    .from("users")
    .update({ is_active: false })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: "Помилка при деактивації користувача" }, { status: 500 });
  }

  // 5. Log audit
  await logAudit("admin.user.deactivate", {
    actorUserId: sess.uid,
    targetUserId: id,
    targetType: "user",
    meta: { role: targetUser.role },
  });

  return NextResponse.json({ ok: true });
}
