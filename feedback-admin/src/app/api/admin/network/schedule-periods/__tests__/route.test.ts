import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
const mockLogAudit = vi.fn(async () => {});

vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from: mockFrom })) }));
vi.mock("@/lib/audit", () => ({
  logAudit: mockLogAudit,
  ipFromRequest: vi.fn(() => "127.0.0.1"),
  uaFromRequest: vi.fn(() => "test-agent"),
}));

const adminSession = { uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "admin" };

function request(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("store schedule periods API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockResolvedValue(adminSession);
  });

  it("rejects an invalid month before querying Supabase", async () => {
    const { POST } = await import("../route");
    const response = await POST(request("POST", "/api/admin/network/schedule-periods", { month: "2026-13" }));

    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates the exact monthly period and writes the audit event", async () => {
    const { POST } = await import("../route");
    mockFrom.mockReturnValue({
      insert: (payload: Record<string, unknown>) => {
        expect(payload.period_start).toBe("2026-02-01");
        expect(payload.period_end).toBe("2026-02-28");
        expect(payload.created_by).toBe(adminSession.uid);
        return {
          select: () => ({
            single: async () => ({
              data: { id: "11111111-1111-1111-1111-111111111111", period_start: "2026-02-01", period_end: "2026-02-28", status: "draft", timezone: "Europe/Kyiv", row_version: 1 },
              error: null,
            }),
          }),
        };
      },
    });

    const response = await POST(request("POST", "/api/admin/network/schedule-periods", { month: "2026-02" }));

    expect(response.status).toBe(201);
    expect(mockLogAudit).toHaveBeenCalledWith("admin.schedule.period_create", expect.objectContaining({ actorUserId: adminSession.uid }));
  });

  it("maps a duplicate period to a conflict response", async () => {
    const { POST } = await import("../route");
    mockFrom.mockReturnValue({
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }),
      }),
    });

    const response = await POST(request("POST", "/api/admin/network/schedule-periods", { month: "2026-09" }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("schedule_period_exists");
  });
});
