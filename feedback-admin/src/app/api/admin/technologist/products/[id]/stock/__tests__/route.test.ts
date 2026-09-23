import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const getLiveProductStock = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/admin/posterStock", () => ({ getLiveProductStock, PosterStockError: class PosterStockError extends Error {} }));

describe("product stock API", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.POSTER_TOKEN = "test-token"; });

  it("rejects unauthenticated and non-super-admin users before Poster access", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/stock"), { params: { id: "121" } });
    expect(response.status).toBe(403);
    expect(requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(getLiveProductStock).not.toHaveBeenCalled();
  });

  it("rejects invalid ids", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    const { GET } = await import("../route");
    expect((await GET(new Request("http://localhost/stock"), { params: { id: "121x" } })).status).toBe(400);
    expect(getLiveProductStock).not.toHaveBeenCalled();
  });

  it("returns live stock without HTTP caching", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    getLiveProductStock.mockResolvedValue({ productId: 121, stores: [] });
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/stock"), { params: { id: "121" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(getLiveProductStock).toHaveBeenCalledWith(121, "test-token");
  });

  it("returns 404 for a catalog card absent from current Poster", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    const { GET } = await import("../route");
    const { PosterApiError } = await import("@/lib/admin/posterApi");
    getLiveProductStock.mockRejectedValue(new PosterApiError("product_missing_in_poster"));
    const response = await GET(new Request("http://localhost/stock"), { params: { id: "1156" } });
    expect(response.status).toBe(404);
  });
});
