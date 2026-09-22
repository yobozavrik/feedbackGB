import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: () => ({ from: mockFrom }) }));

describe("store reports API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockResolvedValue({ uid: "admin-id", role: "admin" });
  });

  it("denies unauthenticated requests before reading data", async () => {
    mockRequireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/stores/reports"));
    expect(response.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid pagination and periods before reading data", async () => {
    const { GET } = await import("../route");
    for (const query of ["page=11", "limit=1001", "period=7", "as_of=invalid"]) {
      const response = await GET(new Request(`http://localhost/api/admin/stores/reports?${query}`));
      expect(response.status).toBe(400);
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns a page of feed and a seller model without PIN hashes", async () => {
    const feed = [{ id: "feedback-1", created_at: "2026-09-22T00:00:00Z", store_id: 1 }];
    const range = vi.fn().mockResolvedValue({ data: feed, error: null });
    mockFrom.mockImplementation((table: string) => table === "feedback_feed"
      ? {
          select: () => ({
            gte: () => ({
              lt: () => ({ order: () => ({ order: () => ({ range }) }) }),
            }),
          }),
        }
      : {
          select: () => ({
            order: async () => ({ data: [{ id: "seller-1", full_name: "Seller", store_id: 1, is_active: true, pin_hash: "secret-hash", last_login: null }], error: null }),
          }),
        });

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/stores/reports?page=1"));
    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(0, 999);
    expect(mockFrom).toHaveBeenCalledWith("feedback_feed");
    expect(mockFrom).toHaveBeenCalledWith("users");
    const text = await response.text();
    expect(text).not.toContain("secret-hash");
    expect(JSON.parse(text)).toMatchObject({
      feed,
      sellers: [{ id: "seller-1", has_pin: true }],
      hasMore: false,
      page: 1,
      windowDays: 90,
    });
  });

  it("does not reread sellers on later pages", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockReturnValue({
      select: () => ({ gte: () => ({ lt: () => ({ order: () => ({ order: () => ({ range }) }) }) }) }),
    });
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/stores/reports?page=2"));
    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(1000, 1999);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});
