import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from: mockFrom })) }));

describe("schedule store summary API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockResolvedValue({ uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "admin" });
  });

  it("rejects an unauthenticated request", async () => {
    mockRequireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api?month=2026-09"));
    expect(response.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid months before querying", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api?month=September"));
    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reads only the requested month from the store summary view", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: (field: string, value: string) => {
          expect(field).toBe("period_start");
          expect(value).toBe("2026-09-01");
          return { order: async () => ({ data: [{ store_id: 1, planned_minutes: 600 }], error: null }) };
        },
      }),
    });
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api?month=2026-09"));
    expect(response.status).toBe(200);
    expect((await response.json()).stores).toEqual([{ store_id: 1, planned_minutes: 600 }]);
  });
});
