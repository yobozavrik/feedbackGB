import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock value for cookies
let mockSessionCookieValue = "valid-seller-token";

// Mock next/headers cookies
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      if (name === "fbgb_session") {
        return { value: mockSessionCookieValue };
      }
      return null;
    },
  }),
}));

// Mock verifySession to return a mock session
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "fbgb_session",
  verifySession: vi.fn(async (token) => {
    if (token === "valid-seller-token") {
      return {
        uid: "seller-uid-123",
        full_name: "Seller Submitter",
        role: "seller",
        store_id: 11,
      };
    }
    if (token === "different-seller-token") {
      return {
        uid: "seller-uid-456",
        full_name: "Different Seller",
        role: "seller",
        store_id: 11,
      };
    }
    return null;
  }),
}));

// Mock supabase module
const mockSupabaseRpc = vi.fn(async () => ({ error: null }));
const mockSupabaseInsert = vi.fn();
const mockSupabaseSelect = vi.fn();

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getServerSupabase: vi.fn(() => ({
    rpc: mockSupabaseRpc,
    from: vi.fn((table) => {
      if (table === "v_stores") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 11, name: "Store 11" }, error: null }),
            }),
          }),
        };
      }
      if (table === "v_products") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 1, name: "Product 1", unit: "шт" }, error: null }),
            }),
          }),
        };
      }
      if (table === "feedback") {
        return {
          insert: mockSupabaseInsert,
          select: mockSupabaseSelect,
        };
      }
      return {};
    }),
  })),
}));

function feedbackRequest(body: unknown, token = "valid-seller-token") {
  mockSessionCookieValue = token;
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/feedback", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSupabaseInsert.mockReset();
    mockSupabaseSelect.mockReset();
    mockSupabaseRpc.mockReset();
    mockSessionCookieValue = "valid-seller-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/feedback/route");
  }

  it("successfully inserts feedback with client_submission_id and client_created_at", async () => {
    mockSupabaseInsert.mockResolvedValue({ error: null });

    const { POST } = await loadRoute();
    const uuid = "4a187a5b-59c4-42b7-a36c-2f4161a15ea2";
    const dateStr = "2026-06-30T09:00:00.000Z";

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: { comment: "Test comment" },
        client_submission_id: uuid,
        client_created_at: dateStr,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockSupabaseInsert).toHaveBeenCalledTimes(1);
    const insertedRecord = mockSupabaseInsert.mock.calls[0][0];
    expect(insertedRecord.client_submission_id).toBe(uuid);
    expect(insertedRecord.client_created_at).toBe(dateStr);
  });

  it("rejects client_created_at that is in the future", async () => {
    const { POST } = await loadRoute();
    const uuid = "4a187a5b-59c4-42b7-a36c-2f4161a15ea2";
    // Future date: 1 hour from now
    const futureDateStr = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: { comment: "Test comment" },
        client_submission_id: uuid,
        client_created_at: futureDateStr,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Час створення відгуку не може бути у майбутньому");
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  it("rejects malformed client_submission_id", async () => {
    const { POST } = await loadRoute();

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: { comment: "Test comment" },
        client_submission_id: "not-a-uuid",
        client_created_at: "2026-06-30T09:00:00.000Z",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid client_submission_id");
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  it("handles duplicate key (23505) and returns 200 OK if owner matches", async () => {
    // DB returns unique key violation
    mockSupabaseInsert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    // Subquery for existing record returns the same owner (seller-uid-123)
    mockSupabaseSelect.mockImplementation(() => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { id: "existing-id", user_id: "seller-uid-123" },
          error: null,
        }),
      }),
    }));

    const { POST } = await loadRoute();
    const uuid = "4a187a5b-59c4-42b7-a36c-2f4161a15ea2";
    const dateStr = "2026-06-30T09:00:00.000Z";

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: { comment: "Test comment" },
        client_submission_id: uuid,
        client_created_at: dateStr,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBe(true);
  });

  it("handles duplicate key (23505) and returns 409 Conflict if owner does not match", async () => {
    // DB returns unique key violation
    mockSupabaseInsert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    // Subquery for existing record returns a DIFFERENT owner (seller-uid-123) than session owner (seller-uid-456)
    mockSupabaseSelect.mockImplementation(() => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { id: "existing-id", user_id: "seller-uid-123" },
          error: null,
        }),
      }),
    }));

    const { POST } = await loadRoute();
    const uuid = "4a187a5b-59c4-42b7-a36c-2f4161a15ea2";
    const dateStr = "2026-06-30T09:00:00.000Z";

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: { comment: "Test comment" },
        client_submission_id: uuid,
        client_created_at: dateStr,
      }, "different-seller-token")
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Conflict: submission ID already exists under another user");
  });
});
