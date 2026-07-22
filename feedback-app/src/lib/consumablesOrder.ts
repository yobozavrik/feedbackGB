// Server-only helpers that read the warehouse CRM (household_chemicals schema)
// to surface consumables-order state back to the seller:
//   • getConsumablesStatuses  — batch status for the "Мої заявки" list
//   • getConsumablesOrderDetail — items (name/unit/photo) + status + timeline
//
// All reads are keyed by the FeedbackGB feedback.id via
// feedbackgb_order_contributions (feedback_id → order_id). Merged orders (many
// sellers' requests → one CRM order) are handled: we always resolve the order
// the caller's own feedback contributed to. No writes, no schema changes.

import { getWarehouseCrmSupabase } from "./warehouseCrm";
import type { ConsumablesStatus } from "./consumablesStatusMeta";

/**
 * Map a CRM (transfer, order) status pair to the seller-facing status.
 * transfer completed → shipped; any transfer present → picking;
 * order already shipped → shipped; otherwise the order is just accepted.
 */
function deriveStatus(
  transferStatus: string | null | undefined,
  orderStatus: string | null | undefined,
): ConsumablesStatus {
  if (transferStatus === "completed") return "shipped";
  if (transferStatus) return "picking"; // draft / confirmed / in progress
  if (orderStatus === "shipped") return "shipped";
  return "accepted";
}

interface ContributionRow {
  feedback_id: string;
  order_id: string;
  product_id: number;
  quantity_requested: number;
}

/**
 * Batch-resolve the consumables status for a set of feedback ids. Returns a
 * Map keyed by feedback_id; ids with no CRM order are simply absent.
 */
export async function getConsumablesStatuses(
  feedbackIds: string[],
): Promise<Map<string, ConsumablesStatus>> {
  const result = new Map<string, ConsumablesStatus>();
  const db = getWarehouseCrmSupabase();
  if (!db || feedbackIds.length === 0) return result;

  const { data: contribs } = await db
    .from("feedbackgb_order_contributions")
    .select("feedback_id, order_id")
    .in("feedback_id", feedbackIds);
  const rows = (contribs ?? []) as Array<Pick<ContributionRow, "feedback_id" | "order_id">>;
  if (rows.length === 0) return result;

  const feedbackToOrder = new Map<string, string>();
  const orderIds = new Set<string>();
  for (const r of rows) {
    if (!feedbackToOrder.has(r.feedback_id)) feedbackToOrder.set(r.feedback_id, r.order_id);
    orderIds.add(r.order_id);
  }

  const ids = [...orderIds];
  const { data: orders } = await db.from("orders").select("id, status").in("id", ids);
  const orderStatus = new Map(
    ((orders ?? []) as Array<{ id: string; status: string }>).map((o) => [o.id, o.status]),
  );

  const { data: transfers } = await db
    .from("transfers")
    .select("order_id, status, created_at")
    .in("order_id", ids)
    .order("created_at", { ascending: false });
  const latestTransfer = new Map<string, string>();
  for (const t of (transfers ?? []) as Array<{ order_id: string; status: string }>) {
    if (!latestTransfer.has(t.order_id)) latestTransfer.set(t.order_id, t.status);
  }

  for (const [feedbackId, orderId] of feedbackToOrder) {
    result.set(feedbackId, deriveStatus(latestTransfer.get(orderId), orderStatus.get(orderId)));
  }
  return result;
}

export interface ConsumablesOrderItem {
  product_id: number;
  name: string;
  unit: string | null;
  quantity: number;
  photo_url: string | null;
}

export interface ConsumablesOrderDetail {
  status: ConsumablesStatus;
  order_number: string | null;
  items: ConsumablesOrderItem[];
  timeline: {
    submitted_at: string | null;
    picking_at: string | null;
    shipped_at: string | null;
  };
}

/**
 * Full consumables order detail for one feedback id: the line-items this
 * feedback contributed (with real names + photos), the derived status, and the
 * timestamps behind the status timeline. Returns null if there's no CRM order.
 */
export async function getConsumablesOrderDetail(
  feedbackId: string,
): Promise<ConsumablesOrderDetail | null> {
  const db = getWarehouseCrmSupabase();
  if (!db) return null;

  const { data: contribs } = await db
    .from("feedbackgb_order_contributions")
    .select("order_id, product_id, quantity_requested")
    .eq("feedback_id", feedbackId);
  const rows = (contribs ?? []) as Array<Omit<ContributionRow, "feedback_id">>;
  if (rows.length === 0) return null;

  const orderId = rows[0].order_id;
  const productIds = [...new Set(rows.map((r) => r.product_id))];

  const [{ data: products }, { data: photos }, { data: order }, { data: transfers }] =
    await Promise.all([
      db.from("products").select("id, name, unit").in("id", productIds),
      db.from("product_photos").select("product_id, url, sort_order").in("product_id", productIds).order("sort_order", { ascending: true }),
      db.from("orders").select("order_number, status, submitted_at, shipped_at").eq("id", orderId).maybeSingle(),
      db.from("transfers").select("status, created_at, completed_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    ]);

  const productById = new Map(
    ((products ?? []) as Array<{ id: number; name: string; unit: string | null }>).map((p) => [p.id, p]),
  );
  const photoByProduct = new Map<number, string>();
  for (const p of (photos ?? []) as Array<{ product_id: number; url: string }>) {
    if (!photoByProduct.has(p.product_id)) photoByProduct.set(p.product_id, p.url);
  }

  const items: ConsumablesOrderItem[] = rows.map((r) => {
    const p = productById.get(r.product_id);
    return {
      product_id: r.product_id,
      name: p?.name ?? `Товар #${r.product_id}`,
      unit: p?.unit ?? null,
      quantity: Number(r.quantity_requested),
      photo_url: photoByProduct.get(r.product_id) ?? null,
    };
  });

  const orderRow = order as { order_number: string | null; status: string; submitted_at: string | null; shipped_at: string | null } | null;
  const latest = ((transfers ?? []) as Array<{ status: string; created_at: string | null; completed_at: string | null }>)[0];

  return {
    status: deriveStatus(latest?.status, orderRow?.status),
    order_number: orderRow?.order_number ?? null,
    items,
    timeline: {
      submitted_at: orderRow?.submitted_at ?? null,
      picking_at: latest?.created_at ?? null,
      shipped_at: latest?.completed_at ?? orderRow?.shipped_at ?? null,
    },
  };
}
