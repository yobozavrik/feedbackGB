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
// Controls what admin_directions "resolves" to for resolveAssignedAdmin().
// null = no direction configured (default, matches pre-auto-assignment
// behavior). Set per-test to simulate a configured direction.
let mockAdminDirectionAdminId: string | null = null;

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
      if (table === "admin_directions") {
        // resolveAssignedAdmin() awaits the .eq()/.is() chain directly (no
        // terminal .maybeSingle()/.single() call, since a scope can now
        // return 0, 1, or several rows). Both the exact-store and
        // all-stores branches resolve from mockAdminDirectionAdminId so
        // tests can simulate "a direction is configured" without caring
        // which branch matched (that distinction is covered by
        // assignment.test.ts already).
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve: (v: unknown) => void) => {
            resolve({
              data: mockAdminDirectionAdminId ? [{ admin_id: mockAdminDirectionAdminId }] : [],
              error: null,
            });
          },
        };
        return chain;
      }
      if (table === "audit_log") {
        return {
          update: () => ({
            eq: () => ({
              is: async () => ({ error: null }),
            }),
          }),
        };
      }
      return {};
    }),
  })),
}));

// The route now does `.insert(record).select("id").single()` (it needs the
// inserted id back to attach it to the admin notification), so the mock
// insert must return a chainable object rather than resolving directly.
function mockInsertResolves(result: { data?: unknown; error?: unknown }) {
  mockSupabaseInsert.mockImplementation(() => ({
    select: () => ({
      single: async () => result,
    }),
  }));
}

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
    mockAdminDirectionAdminId = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/feedback/route");
  }

  it("successfully inserts feedback with client_submission_id and client_created_at", async () => {
    mockInsertResolves({ data: { id: "feedback-id" }, error: null });

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
    mockInsertResolves({
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
    mockInsertResolves({
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

/**
 * Characterization tests for the payload validation rules. They lock the
 * exact status codes and error strings the route returns today, so the
 * validation logic can be moved/refactored without changing behavior.
 */
describe("POST /api/feedback — payload validation", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSupabaseInsert.mockReset();
    mockSupabaseSelect.mockReset();
    mockSupabaseRpc.mockReset();
    mockSessionCookieValue = "valid-seller-token";
    mockAdminDirectionAdminId = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/feedback/route");
  }

  async function expectRejected(payload: unknown, error: string) {
    const { POST } = await loadRoute();
    const res = await POST(feedbackRequest(payload));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(error);
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  }

  it("rejects an unknown category", async () => {
    await expectRejected({ category: "nonsense", fields: {} }, "Unknown category");
  });

  it("rejects a payload with too many fields", async () => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < 41; i += 1) fields[`f${i}`] = "v";
    await expectRejected(
      { category: "missing_item", product_id: 1, quantity: 1, fields },
      "Too many fields",
    );
  });

  it("rejects an overlong field value", async () => {
    await expectRejected(
      {
        category: "missing_item",
        product_id: 1,
        quantity: 1,
        fields: { comment: "x".repeat(4001) },
      },
      "Field too long: comment",
    );
  });

  it("rejects a field of unsupported type", async () => {
    await expectRejected(
      {
        category: "missing_item",
        product_id: 1,
        quantity: 1,
        fields: { comment: true },
      },
      "Invalid field type: comment",
    );
  });

  it("rejects when a required category field is missing", async () => {
    await expectRejected(
      { category: "supply_problem", fields: {} },
      "Missing required field: supplier_or_item",
    );
  });

  it("rejects a product category without product_id or item_name", async () => {
    await expectRejected(
      { category: "missing_item", fields: {} },
      "Обери товар або введи назву",
    );
  });

  it("rejects a product_id submission without a positive quantity", async () => {
    await expectRejected(
      { category: "missing_item", product_id: 1, fields: {} },
      "Вкажи кількість",
    );
  });

  it("rejects more than 5 photos", async () => {
    await expectRejected(
      {
        category: "missing_item",
        product_id: 1,
        quantity: 1,
        fields: {},
        photo_urls: Array.from({ length: 6 }, () => "data:image/png;base64,aaaa"),
      },
      "Too many photos: max 5",
    );
  });

  it("drops a non-data-URL photo instead of storing it", async () => {
    mockInsertResolves({ data: { id: "feedback-id" }, error: null });
    const { POST } = await loadRoute();

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        product_id: 1,
        quantity: 1,
        fields: {},
        photo_url: "https://evil.example.com/x.jpg",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockSupabaseInsert).toHaveBeenCalledTimes(1);
    const record = mockSupabaseInsert.mock.calls[0][0];
    expect(record.photo_url).toBeNull();
  });

  it("trims and length-caps store_label", async () => {
    mockInsertResolves({ data: { id: "feedback-id" }, error: null });
    const { POST } = await loadRoute();

    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        product_id: 1,
        quantity: 1,
        fields: {},
        store_label: `  ${"a".repeat(100)}  `,
      }),
    );

    expect(res.status).toBe(200);
    const record = mockSupabaseInsert.mock.calls[0][0];
    expect(record.store_label).toBe("a".repeat(80));
  });
});

describe("POST /api/feedback — auto-assignment", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSupabaseInsert.mockReset();
    mockSupabaseSelect.mockReset();
    mockSupabaseRpc.mockReset();
    mockSessionCookieValue = "valid-seller-token";
    mockAdminDirectionAdminId = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/feedback/route");
  }

  it("stamps assigned_to from the resolved admin direction", async () => {
    mockInsertResolves({ data: { id: "feedback-id" }, error: null });
    mockAdminDirectionAdminId = "admin-uuid-123";

    const { POST } = await loadRoute();
    const res = await POST(
      feedbackRequest({
        category: "defect",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: { defect_type: "broken", comment: "cracked" },
      }),
    );

    expect(res.status).toBe(200);
    const record = mockSupabaseInsert.mock.calls[0][0];
    expect(record.assigned_to).toBe("admin-uuid-123");
  });

  it("leaves assigned_to null when no direction is configured for the category", async () => {
    mockInsertResolves({ data: { id: "feedback-id" }, error: null });
    mockAdminDirectionAdminId = null;

    const { POST } = await loadRoute();
    const res = await POST(
      feedbackRequest({
        category: "missing_item",
        store_id: 11,
        product_id: 1,
        quantity: 1,
        fields: {},
      }),
    );

    expect(res.status).toBe(200);
    const record = mockSupabaseInsert.mock.calls[0][0];
    expect(record.assigned_to).toBeNull();
  });
});
