import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal fake supabase-js query-builder chain. Every chain method
// (select/eq/in/order) returns the same object so any call order works; the
// object is thenable so `await db.from(t)...<lastCall>()` resolves directly
// to `result`, and `.maybeSingle()` is a real async terminal (used inside
// Promise.all in getConsumablesOrderDetail).
function qb(result: { data: unknown; error?: unknown }) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    order: () => obj,
    maybeSingle: async () => result,
  };
  (obj as { then: unknown }).then = (
    onFulfilled: (v: typeof result) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return obj;
}

let tableData: Record<string, { data: unknown; error?: unknown }> = {};
let warehouseAvailable = true;

vi.mock("@/lib/warehouseCrm", () => ({
  getWarehouseCrmSupabase: () => {
    if (!warehouseAvailable) return null;
    return {
      from: (table: string) => qb(tableData[table] ?? { data: [], error: null }),
    };
  },
}));

async function loadModule() {
  return await import("@/lib/consumablesOrder");
}

describe("consumablesOrder", () => {
  beforeEach(() => {
    vi.resetModules();
    tableData = {};
    warehouseAvailable = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getConsumablesSummaries", () => {
    it("returns an empty map when the warehouse CRM isn't configured", async () => {
      warehouseAvailable = false;
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries(["fb-1"]);
      expect(result.size).toBe(0);
    });

    it("returns an empty map for an empty id list without querying", async () => {
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries([]);
      expect(result.size).toBe(0);
    });

    it("derives accepted when the order has no transfer yet", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [{ feedback_id: "fb-1", order_id: "order-1" }],
          error: null,
        },
        orders: { data: [{ id: "order-1", status: "submitted" }], error: null },
        transfers: { data: [], error: null },
      };
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries(["fb-1"]);
      expect(result.get("fb-1")).toEqual({ status: "accepted", itemCount: 1 });
    });

    it("derives picking once a transfer exists (draft = «Сформувати переміщення»)", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [{ feedback_id: "fb-1", order_id: "order-1" }],
          error: null,
        },
        orders: { data: [{ id: "order-1", status: "submitted" }], error: null },
        transfers: { data: [{ order_id: "order-1", status: "draft", created_at: "2026-07-01T10:00:00Z" }], error: null },
      };
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries(["fb-1"]);
      expect(result.get("fb-1")?.status).toBe("picking");
    });

    it("derives shipped once the transfer is completed («Підтвердити переміщення»)", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [{ feedback_id: "fb-1", order_id: "order-1" }],
          error: null,
        },
        orders: { data: [{ id: "order-1", status: "submitted" }], error: null },
        transfers: { data: [{ order_id: "order-1", status: "completed", created_at: "2026-07-01T10:00:00Z" }], error: null },
      };
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries(["fb-1"]);
      expect(result.get("fb-1")?.status).toBe("shipped");
    });

    it("counts one item per contribution row, per feedback id", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [
            { feedback_id: "fb-1", order_id: "order-1" },
            { feedback_id: "fb-1", order_id: "order-1" },
            { feedback_id: "fb-1", order_id: "order-1" },
            { feedback_id: "fb-2", order_id: "order-1" },
          ],
          error: null,
        },
        orders: { data: [{ id: "order-1", status: "submitted" }], error: null },
        transfers: { data: [], error: null },
      };
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries(["fb-1", "fb-2"]);
      expect(result.get("fb-1")?.itemCount).toBe(3);
      expect(result.get("fb-2")?.itemCount).toBe(1);
    });

    it("omits ids that never contributed to a CRM order", async () => {
      tableData = {
        feedbackgb_order_contributions: { data: [], error: null },
      };
      const { getConsumablesSummaries } = await loadModule();
      const result = await getConsumablesSummaries(["fb-never-synced"]);
      expect(result.has("fb-never-synced")).toBe(false);
    });

    it("propagates a query error instead of silently returning an empty map", async () => {
      tableData = {
        feedbackgb_order_contributions: { data: null, error: { message: "db down" } },
      };
      const { getConsumablesSummaries } = await loadModule();
      await expect(getConsumablesSummaries(["fb-1"])).rejects.toEqual({ message: "db down" });
    });
  });

  describe("getConsumablesOrderDetail", () => {
    it("returns null when the feedback id never contributed to a CRM order", async () => {
      tableData = { feedbackgb_order_contributions: { data: [], error: null } };
      const { getConsumablesOrderDetail } = await loadModule();
      const result = await getConsumablesOrderDetail("fb-1");
      expect(result).toBeNull();
    });

    it("resolves item name/unit/category/photo and falls back for unknown products", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [
            { order_id: "order-1", product_id: 1, quantity_requested: 2 },
            { order_id: "order-1", product_id: 999, quantity_requested: 1 },
          ],
          error: null,
        },
        products: {
          data: [{ id: 1, name: "Губка для посуду", unit: "уп", category_id: 5 }],
          error: null,
        },
        product_photos: {
          data: [{ product_id: 1, url: "https://cdn.example/photo.jpg" }],
          error: null,
        },
        product_categories: { data: [{ id: 5, name: "Господарчі товари" }], error: null },
        orders: {
          data: { order_number: "ЗМ-2026-000009", status: "submitted", submitted_at: "2026-07-01T10:00:00Z", shipped_at: null },
          error: null,
        },
        transfers: { data: [], error: null },
      };
      const { getConsumablesOrderDetail } = await loadModule();
      const result = await getConsumablesOrderDetail("fb-1");

      expect(result?.order_number).toBe("ЗМ-2026-000009");
      expect(result?.status).toBe("accepted");
      expect(result?.items).toEqual([
        { product_id: 1, name: "Губка для посуду", unit: "уп", category_name: "Господарчі товари", quantity: 2, photo_url: "https://cdn.example/photo.jpg" },
        { product_id: 999, name: "Товар #999", unit: null, category_name: null, quantity: 1, photo_url: null },
      ]);
    });

    it("fills the timeline from the order submission and the transfer completion", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [{ order_id: "order-1", product_id: 1, quantity_requested: 1 }],
          error: null,
        },
        products: { data: [{ id: 1, name: "Product 1", unit: "шт", category_id: null }], error: null },
        product_photos: { data: [], error: null },
        orders: {
          data: { order_number: "ЗМ-1", status: "shipped", submitted_at: "2026-07-01T10:00:00Z", shipped_at: "2026-07-02T09:00:00Z" },
          error: null,
        },
        transfers: {
          data: [{ status: "completed", created_at: "2026-07-01T12:00:00Z", completed_at: "2026-07-02T08:00:00Z" }],
          error: null,
        },
      };
      const { getConsumablesOrderDetail } = await loadModule();
      const result = await getConsumablesOrderDetail("fb-1");

      expect(result?.status).toBe("shipped");
      expect(result?.timeline).toEqual({
        submitted_at: "2026-07-01T10:00:00Z",
        picking_at: "2026-07-01T12:00:00Z",
        shipped_at: "2026-07-02T08:00:00Z",
      });
    });

    it("propagates a query error", async () => {
      tableData = {
        feedbackgb_order_contributions: { data: null, error: { message: "db down" } },
      };
      const { getConsumablesOrderDetail } = await loadModule();
      await expect(getConsumablesOrderDetail("fb-1")).rejects.toEqual({ message: "db down" });
    });
  });

  describe("getConsumablesSuccessStage", () => {
    it("returns step 0 for a missing id", async () => {
      const { getConsumablesSuccessStage } = await loadModule();
      expect(await getConsumablesSuccessStage(undefined)).toBe(0);
    });

    it("returns step 0 for a malformed (non-uuid) id, without querying the CRM", async () => {
      const { getConsumablesSuccessStage } = await loadModule();
      expect(await getConsumablesSuccessStage("not-a-uuid")).toBe(0);
    });

    it("returns step 0 when the order isn't visible in the CRM yet", async () => {
      tableData = { feedbackgb_order_contributions: { data: [], error: null } };
      const { getConsumablesSuccessStage } = await loadModule();
      expect(await getConsumablesSuccessStage("4a187a5b-59c4-42b7-a36c-2f4161a15ea2")).toBe(0);
    });

    it("returns the real stage for a merged order that's already picking", async () => {
      tableData = {
        feedbackgb_order_contributions: {
          data: [{ order_id: "order-1", product_id: 1, quantity_requested: 1 }],
          error: null,
        },
        products: { data: [{ id: 1, name: "Product 1", unit: "шт", category_id: null }], error: null },
        product_photos: { data: [], error: null },
        orders: { data: { order_number: "ЗМ-1", status: "submitted", submitted_at: null, shipped_at: null }, error: null },
        transfers: { data: [{ status: "draft", created_at: "2026-07-01T12:00:00Z", completed_at: null }], error: null },
      };
      const { getConsumablesSuccessStage } = await loadModule();
      expect(await getConsumablesSuccessStage("4a187a5b-59c4-42b7-a36c-2f4161a15ea2")).toBe(1);
    });

    it("degrades to step 0 instead of throwing when the CRM lookup fails", async () => {
      tableData = {
        feedbackgb_order_contributions: { data: null, error: { message: "db down" } },
      };
      const { getConsumablesSuccessStage } = await loadModule();
      await expect(getConsumablesSuccessStage("4a187a5b-59c4-42b7-a36c-2f4161a15ea2")).resolves.toBe(0);
    });
  });
});
