import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const getLiveProductTechCard = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/admin/posterTechCard", () => ({ getLiveProductTechCard, PosterTechCardError: class PosterTechCardError extends Error {} }));

describe("product technical card API", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); process.env.POSTER_TOKEN = "test-token"; });

  it("rejects non-super-admin before calling Poster", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/tech-card"), { params: { id: "121" } });
    expect(response.status).toBe(403);
    expect(requireAdminSession).toHaveBeenCalledWith("super_admin");
    expect(getLiveProductTechCard).not.toHaveBeenCalled();
  });

  it("rejects invalid ids", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    const { GET } = await import("../route");
    expect((await GET(new Request("http://localhost/tech-card"), { params: { id: "121x" } })).status).toBe(400);
    expect(getLiveProductTechCard).not.toHaveBeenCalled();
  });

  it("returns a fresh card without HTTP caching", async () => {
    requireAdminSession.mockResolvedValue({ uid: "admin" });
    getLiveProductTechCard.mockResolvedValue({ recipe: { productId: 121, ingredients: [] }, checkedAt: "2026-09-23T00:00:00Z" });
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/tech-card"), { params: { id: "121" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(getLiveProductTechCard).toHaveBeenCalledWith(121, "test-token");
  });
});
