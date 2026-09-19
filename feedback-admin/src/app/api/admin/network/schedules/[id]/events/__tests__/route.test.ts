import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from: mockFrom })) }));

const shiftId = "11111111-1111-1111-1111-111111111111";
const actorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("schedule shift events API", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRequireAdminSession.mockResolvedValue({ uid: actorId, role: "admin" }); });

  it("rejects unauthenticated access", async () => {
    mockRequireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost"), { params: { id: shiftId } });
    expect(response.status).toBe(403); expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns chronological events with actor names", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "store_work_shift_events") return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: "e", event_type: "created", actor_user_id: actorId, occurred_at: "2026-09-01T06:00:00.000Z", reason: null, before_state: null, after_state: {} }], error: null }) }) }) };
      if (table === "users") return { select: () => ({ in: async () => ({ data: [{ id: actorId, full_name: "Адмін", display_label: "Адмін" }], error: null }) }) };
      throw new Error(`unexpected table ${table}`);
    });
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost"), { params: { id: shiftId } });
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.events[0].actor_name).toBe("Адмін");
  });
});
