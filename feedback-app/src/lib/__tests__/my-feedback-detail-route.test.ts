import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockSessionCookieValue = "seller-a-token";

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      if (name === "fbgb_session") return { value: mockSessionCookieValue };
      return null;
    },
  }),
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "fbgb_session",
  verifySession: vi.fn(async (token) => {
    if (token === "seller-a-token") {
      return { uid: "seller-a-uid", full_name: "Seller A", role: "seller", store_id: 11 };
    }
    return null;
  }),
}));

const OWNED_ID = "4a187a5b-59c4-42b7-a36c-2f4161a15ea2";
const OTHERS_ID = "5b298b6c-6ad5-53c8-b47d-3f5272b26fb3";
const CONSUMABLES_ID = "6c3a9c7d-7be6-64d9-c58e-4063836370c5";

const FEEDBACK_ROWS: Record<string, { id: string; user_id: string; category: string; status: string }> = {
  [OWNED_ID]: { id: OWNED_ID, user_id: "seller-a-uid", category: "in_progress", status: "in_progress" },
  [OTHERS_ID]: { id: OTHERS_ID, user_id: "seller-b-uid", category: "missing_item", status: "new" },
  [CONSUMABLES_ID]: { id: CONSUMABLES_ID, user_id: "seller-a-uid", category: "consumables_request", status: "new" },
};

const mockGetConsumablesOrderDetail = vi.fn(async (_id: string) => null as unknown);

vi.mock("@/lib/consumablesOrder", () => ({
  getConsumablesOrderDetail: mockGetConsumablesOrderDetail,
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getServerSupabase: vi.fn(() => ({
    from: (table: string) => {
      if (table === "feedback_feed") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({ data: FEEDBACK_ROWS[id] ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "feedback_comments") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    id: "comment-1",
                    body: "Взяла в роботу",
                    created_at: "2026-07-01T00:00:00Z",
                    author: { full_name: "Оксана Бондар" },
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

function detailRequest(token = "seller-a-token") {
  mockSessionCookieValue = token;
  return new Request("http://localhost/api/my-feedback/x");
}

describe("GET /api/my-feedback/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSessionCookieValue = "seller-a-token";
    mockGetConsumablesOrderDetail.mockReset();
    mockGetConsumablesOrderDetail.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/my-feedback/[id]/route");
  }

  it("returns the feedback + comment thread for the owner", async () => {
    const { GET } = await loadRoute();
    const res = await GET(detailRequest(), { params: { id: OWNED_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feedback.id).toBe(OWNED_ID);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].author_full_name).toBe("Оксана Бондар");
  });

  it("returns 404 (not 403) for a request owned by someone else", async () => {
    const { GET } = await loadRoute();
    const res = await GET(detailRequest(), { params: { id: OTHERS_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an id that doesn't exist", async () => {
    const { GET } = await loadRoute();
    const missingId = "6c3a9c7d-7be6-64d9-c58e-4063836370c4";
    const res = await GET(detailRequest(), { params: { id: missingId } });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const { GET } = await loadRoute();
    const res = await GET(detailRequest(), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = await loadRoute();
    const res = await GET(detailRequest("bad-token"), { params: { id: OWNED_ID } });
    expect(res.status).toBe(401);
  });

  it("does not query the warehouse CRM for a non-consumables category", async () => {
    const { GET } = await loadRoute();
    const res = await GET(detailRequest(), { params: { id: OWNED_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.consumables).toBeNull();
    expect(mockGetConsumablesOrderDetail).not.toHaveBeenCalled();
  });

  it("attaches the resolved consumables order for a consumables_request row", async () => {
    mockGetConsumablesOrderDetail.mockResolvedValue({
      status: "picking",
      order_number: "ЗМ-2026-000009",
      items: [{ product_id: 1, name: "Губка для посуду", unit: "уп", category_name: "Господарчі товари", quantity: 2, photo_url: null }],
      timeline: { submitted_at: "2026-07-01T10:00:00Z", picking_at: "2026-07-01T12:00:00Z", shipped_at: null },
    });
    const { GET } = await loadRoute();
    const res = await GET(detailRequest(), { params: { id: CONSUMABLES_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockGetConsumablesOrderDetail).toHaveBeenCalledWith(CONSUMABLES_ID);
    expect(body.consumables.status).toBe("picking");
    expect(body.consumables.items).toHaveLength(1);
  });

  it("degrades gracefully (consumables: null) when the warehouse CRM lookup fails", async () => {
    mockGetConsumablesOrderDetail.mockRejectedValue(new Error("warehouse CRM unreachable"));
    const { GET } = await loadRoute();
    const res = await GET(detailRequest(), { params: { id: CONSUMABLES_ID } });
    // A CRM outage must not turn a valid, owned request into an error response.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feedback.id).toBe(CONSUMABLES_ID);
    expect(body.consumables).toBeNull();
  });
});
