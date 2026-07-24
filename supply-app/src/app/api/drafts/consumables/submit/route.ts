import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getServerSupabase } from "@/lib/supabase";
import { getWarehouseCrmSupabase } from "@/lib/warehouseCrm";
import { resolveAssignedAdmin } from "@/lib/assignment";
import { classifyConsumablesCrmFailure } from "@/lib/consumablesOrderError";
import { buildSummary } from "@/lib/summary";
import {
  deleteConsumablesDraft,
  getOrCreateConsumablesDraft,
} from "@/lib/draftsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drafts/consumables/submit — turn the caller's draft into a real
 * feedback row and warehouse order. Same guarantees as POST /api/feedback for
 * consumables:
 *   1) CRM RPC before the feedback insert (user never sees success if the
 *      warehouse rejects);
 *   2) feedback.id === draft.id so a retry hits the same idempotency key on
 *      both sides (feedbackgb_order_contributions + client_submission_id).
 * On success the draft is deleted so the next order starts clean.
 */
export async function POST() {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Сервіс недоступний" }, { status: 503 });

  const draft = await getOrCreateConsumablesDraft(user.id, user.facilityId);
  if (!draft) return NextResponse.json({ error: "Сервіс недоступний" }, { status: 503 });
  if (!Array.isArray(draft.cart_items) || draft.cart_items.length === 0) {
    return NextResponse.json({ error: "Кошик порожній" }, { status: 400 });
  }
  if (!user.facilityId) {
    return NextResponse.json({ error: "Твій цех/склад не прив'язано" }, { status: 400 });
  }

  const { data: facility, error: facilityErr } = await supabase
    .from("facilities")
    .select("crm_location_id, name")
    .eq("id", user.facilityId)
    .maybeSingle();
  if (facilityErr) {
    console.error("[supply] draft submit facility", { code: facilityErr.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
  const rawShopId = (facility as { crm_location_id: string | null } | null)?.crm_location_id;
  const crmShopId = rawShopId != null ? Number(rawShopId) : NaN;
  if (!Number.isFinite(crmShopId)) {
    return NextResponse.json(
      { error: "Твій цех/склад не має CRM-прив'язки. Зверніться до супер-адміністратора." },
      { status: 400 },
    );
  }

  const items = draft.cart_items.map((i) => ({ product_id: i.product_id, quantity: i.quantity }));

  const warehouse = getWarehouseCrmSupabase();
  if (!warehouse) return NextResponse.json({ error: "Складський модуль недоступний" }, { status: 503 });

  const { data: crmResult, error: crmError } = await warehouse.rpc(
    "rpc_create_feedbackgb_supply_consumables_order",
    {
      p_feedback_id: draft.id,
      p_feedback_user_id: user.id,
      p_crm_shop_id: crmShopId,
      p_notes: draft.comment,
      p_items: items,
    },
  );
  const crm = crmResult as { success?: boolean; error?: string; order_id?: string } | null;
  if (crmError || !crm?.success || !crm.order_id) {
    const failure = classifyConsumablesCrmFailure(crmError, crm);
    console.error("[supply] draft submit CRM", { code: crmError?.code, status: failure.status });
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  const cleanFields = { comment: draft.comment ?? null };
  const summary = buildSummary(
    {
      category: "consumables_request",
      fields: cleanFields,
      cart_items: items,
      store_id: null,
      store_label: user.facilityName,
      photo_url: null,
    } as never,
    { display_name: user.name },
    user.facilityName,
  );

  const assignedTo = await resolveAssignedAdmin(supabase, "consumables_request", null);

  const { data: inserted, error } = await supabase
    .from("feedback")
    .insert({
      id: draft.id,
      category: "consumables_request",
      store_id: null,
      store_label: user.facilityName,
      facility_id: user.facilityId,
      user_id: user.id,
      fields: cleanFields,
      cart_items: items,
      photo_url: null,
      tg_verified: false,
      summary,
      assigned_to: assignedTo,
      client_submission_id: draft.id,
      client_created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // Idempotent retry: the CRM contribution is already there, and the
    // feedback row exists under the same id from a prior partial submit.
    if (error.code === "23505") {
      await deleteConsumablesDraft(user.id);
      return NextResponse.json({ ok: true, id: draft.id, duplicate: true });
    }
    console.error("[supply] draft submit insert", { code: error.code });
    return NextResponse.json({ error: "Помилка збереження" }, { status: 500 });
  }

  if (inserted) {
    await supabase
      .from("audit_log")
      .update({ actor: user.id, actor_user_id: user.id })
      .eq("feedback_id", (inserted as { id: string }).id)
      .is("actor_user_id", null);
  }

  await deleteConsumablesDraft(user.id);
  return NextResponse.json({ ok: true, id: draft.id });
}
