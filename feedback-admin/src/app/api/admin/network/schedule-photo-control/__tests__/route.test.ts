import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminSession = vi.fn();
const getServerSupabase = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase }));

describe("GET /api/admin/network/schedule-photo-control", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); requireAdminSession.mockResolvedValue({ uid: "admin" }); });

  it("rejects an invalid month before querying Supabase", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/network/schedule-photo-control?month=2026-13"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_month");
    expect(getServerSupabase).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    requireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/network/schedule-photo-control?month=2026-09"));
    expect(response.status).toBe(403);
  });

  it("returns an explicit migration error instead of empty data", async () => {
    const query = { select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { code: "42P01" } }) }), gte: () => ({ lte: () => ({ order: async () => ({ data: null, error: { code: "42P01" } }) }) }) }) };
    getServerSupabase.mockReturnValue({ from: () => query });
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/network/schedule-photo-control?month=2026-09"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("schedule_photo_control_schema_missing");
  });
});
