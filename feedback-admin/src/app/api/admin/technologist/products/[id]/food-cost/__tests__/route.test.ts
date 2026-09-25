import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ requireAdminSession: vi.fn(), loadFoodcostRecentBreakdown: vi.fn(),
  getServerSupabase: vi.fn(), buildFoodcostProductDetail: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mocked.requireAdminSession }));
vi.mock("@/lib/admin/foodcostRecentNetwork", () => ({ loadFoodcostRecentBreakdown: mocked.loadFoodcostRecentBreakdown }));
vi.mock("@/lib/admin/foodcostProductDetail", () => ({ buildFoodcostProductDetail: mocked.buildFoodcostProductDetail }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));

import { GET } from "../route";
const request = new Request("http://localhost/api/admin/technologist/products/121/food-cost");
const call = (id = "121") => GET(request, { params: { id } });

beforeEach(() => {
  mocked.requireAdminSession.mockReset().mockResolvedValue({ uid: "admin" });
  mocked.loadFoodcostRecentBreakdown.mockReset().mockResolvedValue({ status: "complete", spotIds: [1, 2] });
  mocked.buildFoodcostProductDetail.mockReset().mockReturnValue({ status: "complete", product: { productName: "Пельмені" } });
  mocked.getServerSupabase.mockReset().mockReturnValue({ from: () => ({ select: () => ({
    in: () => ({ order: async () => ({ data: [{ id: 1, name: "Шкільна" }, { id: 2, name: "Роша" }], error: null }) }),
  }) }) });
});

describe("product foodcost detail API", () => {
  it("requires super-admin before reading data", async () => {
    mocked.requireAdminSession.mockResolvedValueOnce(null);
    const response = await call();
    expect(response.status).toBe(403);
    expect(mocked.requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(mocked.loadFoodcostRecentBreakdown).not.toHaveBeenCalled();
  });

  it("rejects invalid product IDs before reading data", async () => {
    expect((await call("0")).status).toBe(400);
    expect((await call("abc")).status).toBe(400);
    expect(mocked.loadFoodcostRecentBreakdown).not.toHaveBeenCalled();
  });

  it("uses the selected store for product detail", async () => {
    const response = await GET(new Request(`${request.url}?spot_id=2`), { params: { id: "121" } });
    expect(response.status).toBe(200);
    expect(mocked.loadFoodcostRecentBreakdown).toHaveBeenCalledWith(expect.any(Date), 2, 7);
  });

  it("rejects an invalid store before reading data", async () => {
    const response = await GET(new Request(`${request.url}?spot_id=bad`), { params: { id: "121" } });
    expect(response.status).toBe(400);
    expect(mocked.loadFoodcostRecentBreakdown).not.toHaveBeenCalled();
  });

  it("uses verified names, no-store, and no raw rows", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocked.buildFoodcostProductDetail).toHaveBeenCalledWith(
      expect.objectContaining({ spotIds: [1, 2] }), 121,
      new Map([[1, "Шкільна"], [2, "Роша"]]));
    expect(await response.json()).toEqual({ status: "complete", product: { productName: "Пельмені" } });
  });

  it("does not query names or present partial facts on incomplete coverage", async () => {
    mocked.loadFoodcostRecentBreakdown.mockResolvedValueOnce({ status: "incomplete" });
    const response = await call();
    expect(response.status).toBe(200);
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
    expect(mocked.buildFoodcostProductDetail).toHaveBeenCalledWith(
      { status: "incomplete" }, 121, new Map());
  });

  it("sanitizes provider and unexpected failures", async () => {
    mocked.loadFoodcostRecentBreakdown.mockRejectedValueOnce(new Error("foodcost_roster_mismatch"))
      .mockRejectedValueOnce(new Error("secret-bearing failure"));
    const unavailable = await call();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "foodcost_source_unavailable" });
    const failed = await call();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "foodcost_product_unavailable" });
  });
});
