import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
const mockLogAudit = vi.fn(async () => {});

vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from: mockFrom })) }));
vi.mock("@/lib/audit", () => ({
  ipFromRequest: vi.fn(() => "127.0.0.1"), uaFromRequest: vi.fn(() => "test"), logAudit: mockLogAudit,
}));

const admin = { uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "admin" };
const absenceId = "11111111-1111-1111-1111-111111111111";
const sellerId = "22222222-2222-2222-2222-222222222222";

function request(body: unknown) {
  return new Request("http://localhost/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("absence PATCH API", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRequireAdminSession.mockResolvedValue(admin); });

  it("requires an authenticated admin before querying", async () => {
    mockRequireAdminSession.mockResolvedValue(null);
    const { PATCH } = await import("../route");
    const response = await PATCH(request({ action: "cancel", row_version: 1, cancel_reason: "Коректна причина" }), { params: { id: absenceId } });
    expect(response.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("requires a row version and a reason before querying", async () => {
    const { PATCH } = await import("../route");
    const missingVersion = await PATCH(request({ action: "cancel", cancel_reason: "Коректна причина" }), { params: { id: absenceId } });
    const missingReason = await PATCH(request({ action: "cancel", row_version: 1, cancel_reason: "ні" }), { params: { id: absenceId } });
    expect(missingVersion.status).toBe(400);
    expect(missingReason.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("cancels with all DB-required fields in one update", async () => {
    const current = {
      id: absenceId, employee_id: sellerId, status: "active", row_version: 3, absence_type: "vacation",
      starts_on: "2026-09-20", ends_on: "2026-09-25", store_id: 1, note: null,
    };
    mockFrom.mockImplementation((table: string) => {
      if (table !== "employee_absences") throw new Error("unexpected table " + table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current, error: null }) }) }),
        update: (payload: Record<string, unknown>) => {
          expect(payload).toMatchObject({ status: "cancelled", cancelled_by: admin.uid, cancel_reason: "Змінилися обставини", updated_by: admin.uid });
          expect(typeof payload.cancelled_at).toBe("string");
          return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: absenceId, row_version: 4, status: "cancelled" }, error: null }) }) }) }) };
        },
      };
    });
    const { PATCH } = await import("../route");
    const response = await PATCH(request({ action: "cancel", row_version: 3, cancel_reason: "Змінилися обставини" }), { params: { id: absenceId } });
    expect(response.status).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledWith("admin.absence.cancel", expect.objectContaining({ targetUserId: sellerId }));
  });

  it("returns a conflict rather than overwriting a concurrent change", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
        id: absenceId, employee_id: sellerId, status: "active", row_version: 4, absence_type: "vacation",
        starts_on: "2026-09-20", ends_on: "2026-09-25", store_id: 1, note: null,
      }, error: null }) }) }),
    });
    const { PATCH } = await import("../route");
    const response = await PATCH(request({ action: "cancel", row_version: 3, cancel_reason: "Змінилися обставини" }), { params: { id: absenceId } });
    expect(response.status).toBe(409);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});
