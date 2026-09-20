import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock value for cookies
let mockSessionCookieValue = "valid-seller-token";
const VALID_JPEG = "data:image/jpeg;base64,/9j/2Q==";

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
    if (token === "valid-admin-token") {
      return {
        uid: "admin-uid-789",
        full_name: "Admin",
        role: "admin",
        store_id: null,
      };
    }
    return null;
  }),
  isAdminTier: (role: string) => role === "admin" || role === "super_admin",
}));

// Mock supabase module
const mockSupabaseRpc = vi.fn(async () => ({ error: null }));
const mockSupabaseInsert = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockStorageUpload = vi.fn();
const mockStorageRemove = vi.fn();
// Controls what admin_directions "resolves" to for resolveAssignedAdmin().
// null = no direction configured (default, matches pre-auto-assignment
// behavior). Set per-test to simulate a configured direction.
let mockAdminDirectionAdminId: string | null = null;
let mockReplacementPermission = false;

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getServerSupabase: vi.fn(() => ({
    rpc: mockSupabaseRpc,
    storage: {
      from: () => ({ upload: mockStorageUpload, remove: mockStorageRemove }),
    },
    from: vi.fn((table) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "seller-uid-123", role: "seller", is_active: true, store_id: 11 }, error: null }),
            }),
          }),
        };
      }
      if (table === "seller_store_permissions") {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => ({ data: mockReplacementPermission ? { id: "replacement-permission" } : null, error: null }),
        };
        return chain;
      }
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
      if (table === "feedback_feed") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: "row-1", summary: "s", created_at: "2026-06-30T00:00:00Z" }],
                error: null,
              }),
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
    mockStorageUpload.mockReset();
    mockStorageRemove.mockReset();
    mockStorageUpload.mockResolvedValue({ error: null });
    mockStorageRemove.mockResolvedValue({ error: null });
    mockSessionCookieValue = "valid-seller-token";
    mockAdminDirectionAdminId = null;
    mockReplacementPermission = false;
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
    mockStorageUpload.mockReset();
    mockStorageRemove.mockReset();
    mockStorageUpload.mockResolvedValue({ error: null });
    mockStorageRemove.mockResolvedValue({ error: null });
    mockSessionCookieValue = "valid-seller-token";
    mockAdminDirectionAdminId = null;
    mockReplacementPermission = false;
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

  it("allows 15 photos only for a photo report", async () => {
    const { validateFeedbackPayload } = await import("@/lib/feedbackValidation");
    const result = validateFeedbackPayload({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 15 }, () => "data:image/jpeg;base64,aaaa"),
    });
    expect(result.ok).toBe(true);
  });

  it.each([0, 1, 5])("rejects a photo report with %i photos", async (photoCount) => {
    const { validateFeedbackPayload } = await import("@/lib/feedbackValidation");
    const result = validateFeedbackPayload({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: photoCount }, () => "data:image/jpeg;base64,aaaa"),
    });
    expect(result).toMatchObject({ ok: false, error: "Потрібно щонайменше 6 фото для звіту", status: 400 });
  });

  it("accepts exactly six photos and rejects a sixteenth photo report image", async () => {
    const { validateFeedbackPayload } = await import("@/lib/feedbackValidation");
    const minimum = validateFeedbackPayload({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 6 }, () => "data:image/jpeg;base64,aaaa"),
    });
    expect(minimum.ok).toBe(true);
    const overflow = validateFeedbackPayload({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 16 }, () => "data:image/jpeg;base64,aaaa"),
    });
    expect(overflow).toMatchObject({ ok: false, error: "Too many photos: max 15" });
  });

  it("rejects five photo report images before Storage or database writes", async () => {
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 5 }, () => VALID_JPEG),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Потрібно щонайменше 6 фото для звіту" });
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  it("uploads all fifteen photos of a report and persists their private paths", async () => {
    mockInsertResolves({ data: { id: "feedback-id" }, error: null });
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 15 }, () => VALID_JPEG),
    }));
    expect(response.status).toBe(200);
    expect(mockStorageUpload).toHaveBeenCalledTimes(15);
    const record = mockSupabaseInsert.mock.calls[0][0];
    expect(record.photo_url).toMatch(/^sb:/);
    expect(record.fields.photo_urls).toHaveLength(15);
  });

  it("accepts a photo report for an active replacement store and persists that factual store", async () => {
    mockReplacementPermission = true;
    mockInsertResolves({ data: { id: "replacement-feedback" }, error: null });
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      store_id: 12,
      fields: {},
      photo_urls: Array.from({ length: 6 }, () => VALID_JPEG),
    }));
    expect(response.status).toBe(200);
    expect(mockSupabaseInsert.mock.calls[0][0].store_id).toBe(12);
  });

  it("rejects a photo report for a store without an active replacement permission before upload", async () => {
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      store_id: 12,
      fields: {},
      photo_urls: Array.from({ length: 6 }, () => VALID_JPEG),
    }));
    expect(response.status).toBe(403);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it("removes successfully uploaded files and does not insert a partial report", async () => {
    let calls = 0;
    mockStorageUpload.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? { error: { statusCode: 503 } } : { error: null };
    });
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 15 }, () => VALID_JPEG),
    }));
    expect(response.status).toBe(503);
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove.mock.calls[0][0]).toHaveLength(14);
  });

  it("rejects a partial report even when rollback storage cleanup fails", async () => {
    let calls = 0;
    mockStorageUpload.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? { error: { statusCode: 503 } } : { error: null };
    });
    mockStorageRemove.mockResolvedValue({ error: { message: "cleanup unavailable" } });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 15 }, () => VALID_JPEG),
    }));

    expect(response.status).toBe(503);
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    const cleanup = log.mock.calls
      .map(([message]) => JSON.parse(String(message)) as Record<string, unknown>)
      .find((entry) => entry.event === "photo_report.cleanup_failure");
    expect(cleanup?.photo_paths).toHaveLength(14);
    expect(JSON.stringify(cleanup)).not.toContain("base64");
  });

  it("removes all new report files after a database insert failure", async () => {
    mockInsertResolves({ error: { code: "23514" } });
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: Array.from({ length: 15 }, () => VALID_JPEG),
    }));

    expect(response.status).toBe(500);
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove.mock.calls[0][0]).toHaveLength(15);
  });

  it("removes newly uploaded report files before acknowledging an idempotent duplicate", async () => {
    mockInsertResolves({ error: { code: "23505" } });
    mockSupabaseSelect.mockImplementation(() => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { id: "existing-feedback", user_id: "seller-uid-123" }, error: null }),
      }),
    }));
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      client_submission_id: "4a187a5b-59c4-42b7-a36c-2f4161a15ea2",
      photo_urls: Array.from({ length: 15 }, () => VALID_JPEG),
    }));

    expect(response.status).toBe(200);
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove.mock.calls[0][0]).toHaveLength(15);
  });

  it("removes newly uploaded report files before rejecting another user's duplicate", async () => {
    mockInsertResolves({ error: { code: "23505" } });
    mockSupabaseSelect.mockImplementation(() => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { id: "existing-feedback", user_id: "another-user" }, error: null }),
      }),
    }));
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      client_submission_id: "4a187a5b-59c4-42b7-a36c-2f4161a15ea2",
      photo_urls: Array.from({ length: 15 }, () => VALID_JPEG),
    }));

    expect(response.status).toBe(409);
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove.mock.calls[0][0]).toHaveLength(15);
  });

  it("rejects a declared JPEG without a JPEG signature before upload", async () => {
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: ["data:image/jpeg;base64,YWFhYQ=="],
    }));

    expect(response.status).toBe(400);
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  it("rejects SVG bytes falsely declared as PNG before upload", async () => {
    const { POST } = await loadRoute();
    const response = await POST(feedbackRequest({
      category: "photo_report",
      fields: {},
      photo_urls: ["data:image/png;base64,PHN2Zz48L3N2Zz4="],
    }));

    expect(response.status).toBe(400);
    expect(mockStorageUpload).not.toHaveBeenCalled();
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

describe("GET /api/feedback — admin export authorization (I3)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSessionCookieValue = "valid-admin-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/feedback/route");
  }

  function getRequest(token: string, format?: string) {
    mockSessionCookieValue = token;
    const url = format
      ? `http://localhost/api/feedback?format=${format}`
      : "http://localhost/api/feedback";
    return new Request(url, { method: "GET" });
  }

  it("returns 403 without a session", async () => {
    const { GET } = await loadRoute();
    const res = await GET(getRequest("no-such-token"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a seller session (not admin-tier)", async () => {
    const { GET } = await loadRoute();
    const res = await GET(getRequest("valid-seller-token"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with rows for an admin session", async () => {
    const { GET } = await loadRoute();
    const res = await GET(getRequest("valid-admin-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
  });
});
