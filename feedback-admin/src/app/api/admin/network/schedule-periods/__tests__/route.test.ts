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
const superAdminSession = { uid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "super_admin" };
const periodId = "11111111-1111-1111-1111-111111111111";

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

  it("does not allow a regular admin to publish a period", async () => {
    mockRequireAdminSession.mockImplementation(async (tier?: string) => tier === "super_admin" ? null : adminSession);
    const { PATCH } = await import("../route");

    const response = await PATCH(request("PATCH", `/api/admin/network/schedule-periods?id=${periodId}`, {
      action: "publish", row_version: 1,
    }));

    expect(response.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("requires a close reason before touching the database", async () => {
    mockRequireAdminSession.mockResolvedValue(superAdminSession);
    const { PATCH } = await import("../route");

    const response = await PATCH(request("PATCH", `/api/admin/network/schedule-periods?id=${periodId}`, {
      action: "lock", row_version: 1, lock_reason: "x",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("lock_reason_required");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("publishes a clean draft with optimistic concurrency and audit", async () => {
    mockRequireAdminSession.mockResolvedValue(superAdminSession);
    mockFrom.mockImplementation((table: string) => {
      if (table === "work_schedule_periods") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: periodId, status: "draft", row_version: 3, period_start: "2026-09-01", period_end: "2026-09-30" }, error: null }) }) }),
          update: (payload: Record<string, unknown>) => {
            expect(payload.status).toBe("published");
            expect(payload.published_by).toBe(superAdminSession.uid);
            return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: periodId, status: "published", row_version: 4 }, error: null }) }) }) }) };
          },
        };
      }
      if (table === "v_store_schedule_issues") {
        return { select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const { PATCH } = await import("../route");

    const response = await PATCH(request("PATCH", `/api/admin/network/schedule-periods?id=${periodId}`, {
      action: "publish", row_version: 3,
    }));

    expect(response.status).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledWith("admin.schedule.period_publish", expect.objectContaining({ actorUserId: superAdminSession.uid }));
  });
});
