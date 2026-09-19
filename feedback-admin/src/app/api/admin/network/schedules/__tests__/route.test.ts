import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
const mockLogAudit = vi.fn(async () => {});

vi.mock("@/lib/adminAuth", () => ({
  requireAdminSession: mockRequireAdminSession,
}));

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mockLogAudit,
  ipFromRequest: vi.fn(() => "127.0.0.1"),
  uaFromRequest: vi.fn(() => "test-agent"),
}));

const adminSession = { uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "admin" };
const periodId = "11111111-1111-1111-1111-111111111111";
const sellerId = "22222222-2222-2222-2222-222222222222";
const shiftId = "33333333-3333-3333-3333-333333333333";

function request(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("store schedules API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockResolvedValue(adminSession);
  });

  it("denies an unauthenticated calendar request before querying Supabase", async () => {
    mockRequireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");

    const response = await GET(request("GET", "/api/admin/network/schedules?month=2026-09"));

    expect(response.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an invalid calendar month before querying Supabase", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("GET", "/api/admin/network/schedules?month=September"));

    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects malformed shift input before querying Supabase", async () => {
    const { POST } = await import("../route");

    const response = await POST(request("POST", "/api/admin/network/schedules", {
      period_id: periodId,
      employee_id: sellerId,
      store_id: 1,
      starts_at: "not-a-date",
      ends_at: "2026-09-01T18:00:00+03:00",
      break_minutes: 30,
    }));

    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates a home-store shift and writes the admin audit event", async () => {
    const { POST } = await import("../route");

    mockFrom.mockImplementation((table: string) => {
      if (table === "work_schedule_periods") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: periodId, status: "draft" }, error: null }) }) }) };
      }
      if (table === "users") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: sellerId, role: "seller", is_active: true, store_id: 7 }, error: null }) }) }) };
      }
      if (table === "store_work_shifts") {
        return {
          insert: (payload: Record<string, unknown>) => {
            expect(payload.is_replacement).toBe(false);
            expect(payload.replacement_permission_id).toBeNull();
            expect(payload.created_by).toBe(adminSession.uid);
            return { select: () => ({ single: async () => ({ data: { id: shiftId, row_version: 1 }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const response = await POST(request("POST", "/api/admin/network/schedules", {
      period_id: periodId,
      employee_id: sellerId,
      store_id: 7,
      starts_at: "2026-09-01T09:00:00+03:00",
      ends_at: "2026-09-01T18:00:00+03:00",
      break_minutes: 30,
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ shift: { id: shiftId, row_version: 1 } });
    expect(mockLogAudit).toHaveBeenCalledWith("admin.schedule.create", expect.objectContaining({
      actorUserId: adminSession.uid,
      targetType: "store_work_shift",
    }));
  });

  it("rejects a replacement when no active permission exists", async () => {
    const { POST } = await import("../route");

    mockFrom.mockImplementation((table: string) => {
      if (table === "work_schedule_periods") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: periodId, status: "draft" }, error: null }) }) }) };
      }
      if (table === "users") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: sellerId, role: "seller", is_active: true, store_id: 7 }, error: null }) }) }) };
      }
      if (table === "seller_store_permissions") {
        return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const response = await POST(request("POST", "/api/admin/network/schedules", {
      period_id: periodId,
      employee_id: sellerId,
      store_id: 8,
      starts_at: "2026-09-01T09:00:00+03:00",
      ends_at: "2026-09-01T18:00:00+03:00",
      break_minutes: 30,
    }));

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("replacement_store_not_allowed");
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("rejects an update with a stale row version before writing", async () => {
    const { PATCH } = await import("../route");

    mockFrom.mockImplementation((table: string) => {
      if (table === "store_work_shifts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: shiftId, period_id: periodId, employee_id: sellerId, store_id: 7,
              starts_at: "2026-09-01T06:00:00.000Z", ends_at: "2026-09-01T15:00:00.000Z",
              break_minutes: 30, status: "scheduled", is_replacement: false,
              replacement_permission_id: null, row_version: 2,
            }, error: null,
          }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const response = await PATCH(request("PATCH", `/api/admin/network/schedules?id=${shiftId}`, {
      row_version: 1,
      break_minutes: 45,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("schedule_conflict");
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("requires a reason before changing a published shift", async () => {
    const { PATCH } = await import("../route");
    mockFrom.mockImplementation((table: string) => {
      if (table === "store_work_shifts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: shiftId, period_id: periodId, employee_id: sellerId, store_id: 7, starts_at: "2026-09-01T06:00:00.000Z", ends_at: "2026-09-01T15:00:00.000Z", break_minutes: 30, status: "scheduled", is_replacement: false, replacement_permission_id: null, row_version: 2 }, error: null }) }) }) };
      }
      if (table === "work_schedule_periods") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: periodId, status: "published" }, error: null }) }) }) };
      throw new Error(`unexpected table ${table}`);
    });

    const response = await PATCH(request("PATCH", `/api/admin/network/schedules?id=${shiftId}`, {
      row_version: 2, starts_at: "2026-09-02T06:00:00.000Z", ends_at: "2026-09-02T15:00:00.000Z",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("change_reason_required");
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("moves a shift to an allowed replacement store and records the change", async () => {
    const { PATCH } = await import("../route");
    mockFrom.mockImplementation((table: string) => {
      if (table === "store_work_shifts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: shiftId, period_id: periodId, employee_id: sellerId, store_id: 7, starts_at: "2026-09-01T06:00:00.000Z", ends_at: "2026-09-01T15:00:00.000Z", break_minutes: 30, status: "scheduled", is_replacement: false, replacement_permission_id: null, row_version: 2 }, error: null }) }) }),
          update: (payload: Record<string, unknown>) => {
            expect(payload.store_id).toBe(8);
            expect(payload.is_replacement).toBe(true);
            expect(payload.replacement_permission_id).toBe("44444444-4444-4444-4444-444444444444");
            return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: shiftId, row_version: 3, status: "scheduled" }, error: null }) }) }) }) };
          },
        };
      }
      if (table === "work_schedule_periods") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: periodId, status: "draft" }, error: null }) }) }) };
      if (table === "users") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: sellerId, role: "seller", is_active: true, store_id: 7 }, error: null }) }) }) };
      if (table === "seller_store_permissions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: { id: "44444444-4444-4444-4444-444444444444" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const response = await PATCH(request("PATCH", `/api/admin/network/schedules?id=${shiftId}`, {
      row_version: 2, store_id: 8, starts_at: "2026-09-02T06:00:00.000Z", ends_at: "2026-09-02T15:00:00.000Z",
    }));

    expect(response.status).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledWith("admin.schedule.update", expect.objectContaining({ actorUserId: adminSession.uid }));
  });
});
