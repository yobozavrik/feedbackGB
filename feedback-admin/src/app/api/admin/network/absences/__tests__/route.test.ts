import { beforeEach, describe, expect, it, vi } from "vitest";
const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: vi.fn(() => ({ from: mockFrom })) }));
vi.mock("@/lib/audit", () => ({ ipFromRequest: vi.fn(), uaFromRequest: vi.fn(), logAudit: vi.fn() }));
const admin = { uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "admin" };
const sellerId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function request(body: unknown) { return new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
describe("absence POST API", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRequireAdminSession.mockResolvedValue(admin); });
  it("rejects an impossible calendar date before writing", async () => {
    const { POST } = await import("../route");
    const response = await POST(request({ employee_id: sellerId, absence_type: "vacation", starts_on: "2026-02-30", ends_on: "2026-03-02" }));
    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
