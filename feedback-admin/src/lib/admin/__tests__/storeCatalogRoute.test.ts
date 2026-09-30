import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const loadStoreCategoryProductAnalytics = vi.fn();
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from })) }));
vi.mock("@/lib/admin/storeCategoryProductAnalytics", () => ({ loadStoreCategoryProductAnalytics }));

const endpoint = "http://localhost/api/admin/stores/analytics/categories";

describe("store category/product analytics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ uid: "admin", role: "super_admin" });
    order.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    loadStoreCategoryProductAnalytics.mockResolvedValue({ methodologyVersion: "store-category-product-v1" });
  });

  it("authorizes before source access", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { serveStoreCatalogView } = await import("../storeCatalogRoute");
    const result = await serveStoreCatalogView(new Request(`${endpoint}?view=categories&period=7d`), "categories");
    expect(result.status).toBe(403); expect(from).not.toHaveBeenCalled();
  });

  it("passes bounded identity, scope and pagination to the reader", async () => {
    const { serveStoreCatalogView } = await import("../storeCatalogRoute");
    const result = await serveStoreCatalogView(new Request(`${endpoint}?view=products&period=7d&spot_ids=2,1&product_id=10&modification_id=0&page=2&page_size=50`), "products");
    expect(result.status).toBe(200);
    expect(loadStoreCategoryProductAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      spotIds: [1, 2], productId: 10, modificationId: 0, page: 2, pageSize: 50,
    }));
  });

  it("rejects a view mismatch", async () => {
    const { serveStoreCatalogView } = await import("../storeCatalogRoute");
    const result = await serveStoreCatalogView(new Request(`${endpoint}?view=products&period=7d`), "categories");
    expect(result.status).toBe(400); expect(loadStoreCategoryProductAnalytics).not.toHaveBeenCalled();
  });

  it("maps an unapplied migration to 503", async () => {
    loadStoreCategoryProductAnalytics.mockRejectedValue(new Error("store_catalog_schema_missing"));
    const { serveStoreCatalogView } = await import("../storeCatalogRoute");
    const result = await serveStoreCatalogView(new Request(`${endpoint}?view=categories&period=7d`), "categories");
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: "store_catalog_schema_missing" });
  });
});
