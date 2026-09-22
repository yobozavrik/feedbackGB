import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdminSession = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockLogAudit = vi.fn(async () => {});
const mockNotification = vi.fn(async () => {});
let lastOrFilter = "";

vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: mockRequireAdminSession }));
vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));
vi.mock("@/lib/audit", () => ({
  ipFromRequest: vi.fn(() => "127.0.0.1"),
  uaFromRequest: vi.fn(() => "test"),
  logAudit: mockLogAudit,
}));
vi.mock("@/lib/notifications", () => ({ createNotification: mockNotification }));

const admin = { uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "admin" };
const feedbackId = "11111111-1111-1111-1111-111111111111";
const sellerId = "22222222-2222-2222-2222-222222222222";

function request(method: string, path: string, body?: unknown) {
  return new Request("http://localhost" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function queryResult(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const query: Record<string, unknown> = {};
  for (const key of ["select", "order", "eq"]) query[key] = () => query;
  query.or = (filter: string) => { lastOrFilter = filter; return query; };
  query.then = result.then.bind(result);
  return query;
}

describe("HR absence request API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastOrFilter = "";
    mockRequireAdminSession.mockResolvedValue(admin);
  });

  it("denies unauthenticated Kanban reads before querying", async () => {
    mockRequireAdminSession.mockResolvedValue(null);
    const { GET } = await import("../route");
    const response = await GET(request("GET", "/api/admin/network/absence-requests?month=2026-09"));
    expect(response.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid month and topic before querying", async () => {
    const { GET } = await import("../route");
    const badMonth = await GET(request("GET", "/api/admin/network/absence-requests?month=September"));
    const badTopic = await GET(request("GET", "/api/admin/network/absence-requests?month=2026-09&topic=resignation"));
    expect(badMonth.status).toBe(400);
    expect(badTopic.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns a migration-specific 503 when the read view is absent", async () => {
    mockFrom.mockReturnValue(queryResult(null, { code: "42P01" }));
    const { GET } = await import("../route");
    const response = await GET(request("GET", "/api/admin/network/absence-requests?month=2026-09"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("absence_request_schema_missing");
  });

  it("loads only from the restricted HR request read model", async () => {
    mockFrom.mockReturnValue(queryResult([{ feedback_id: feedbackId, hr_topic: "vacation" }]));
    const { GET } = await import("../route");
    const response = await GET(request("GET", "/api/admin/network/absence-requests?month=2026-09&storeId=3&sellerId=" + sellerId));
    expect(response.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("v_hr_absence_requests");
    expect((await response.json()).requests).toHaveLength(1);
  });

  it("keeps an open sick leave visible until HR makes a decision", async () => {
    mockFrom.mockReturnValue(queryResult([]));
    const { GET } = await import("../route");
    const response = await GET(request("GET", "/api/admin/network/absence-requests?month=2026-10"));
    expect(response.status).toBe(200);
    expect(lastOrFilter).toContain("requested_date_to.is.null,requested_date_from.lte.2026-10-31,feedback_status.in.(new,in_progress)");
  });

  it("rejects malformed approval input before calling the RPC", async () => {
    const { POST } = await import("../[id]/approve/route");
    const response = await POST(request("POST", "/api", { sick_ends_on: "09-22-2026" }), { params: { id: feedbackId } });
    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps a concurrently processed approval to a clear 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "hr_request_not_actionable" } });
    const { POST } = await import("../[id]/approve/route");
    const response = await POST(request("POST", "/api", {}), { params: { id: feedbackId } });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("absence_request_not_actionable");
  });

  it("approves atomically through the SQL RPC and notifies the seller", async () => {
    mockRpc.mockResolvedValue({
      data: [{ feedback_id: feedbackId, absence_id: "33333333-3333-3333-3333-333333333333", applicant_user_id: sellerId, topic: "vacation" }],
      error: null,
    });
    const { POST } = await import("../[id]/approve/route");
    const response = await POST(request("POST", "/api", { note: "Погоджено HR" }), { params: { id: feedbackId } });
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("approve_hr_absence_request", expect.objectContaining({
      p_feedback_id: feedbackId, p_actor_user_id: admin.uid, p_note: "Погоджено HR",
    }));
    expect(mockLogAudit).toHaveBeenCalledWith("admin.hr_request.approve", expect.anything());
    expect(mockNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserId: sellerId }));
  });

  it("requires a visible rejection reason", async () => {
    const { POST } = await import("../[id]/reject/route");
    const response = await POST(request("POST", "/api", { reason: "ні" }), { params: { id: feedbackId } });
    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects through the atomic SQL RPC and records a seller notification", async () => {
    mockRpc.mockResolvedValue({ data: [{ feedback_id: feedbackId, applicant_user_id: sellerId, topic: "day-off" }], error: null });
    const { POST } = await import("../[id]/reject/route");
    const response = await POST(request("POST", "/api", { reason: "Потрібне уточнення дат" }), { params: { id: feedbackId } });
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("reject_hr_absence_request", expect.objectContaining({ p_reason: "Потрібне уточнення дат" }));
    expect(mockNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: "feedback.status_rejected_for_seller",
    }));
  });

  it("takes a new request into review through one RPC transaction", async () => {
    mockRpc.mockResolvedValue({ data: [{ feedback_id: feedbackId, applicant_user_id: sellerId, topic: "transfer" }], error: null });
    const { POST } = await import("../[id]/review/route");
    const response = await POST(request("POST", "/api", { comment: "Перевіряємо можливість" }), { params: { id: feedbackId } });
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("review_hr_absence_request", expect.objectContaining({ p_comment: "Перевіряємо можливість" }));
    expect(mockLogAudit).toHaveBeenCalledWith("admin.hr_request.review", expect.anything());
  });
});
