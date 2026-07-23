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

interface FeedRow {
  id: string;
  user_id: string;
  category: string;
  status: string;
}

const ALL_ROWS: FeedRow[] = [
  { id: "row-1", user_id: "seller-a-uid", category: "missing_item", status: "new" },
  { id: "row-2", user_id: "seller-a-uid", category: "in_progress", status: "in_progress" },
  { id: "row-3", user_id: "seller-b-uid", category: "missing_item", status: "new" },
];

// feedback.cart_items keyed by id — the durable fallback source when the
// warehouse CRM enrichment is unavailable.
const CART_ITEMS: Record<string, unknown[]> = {
  "row-4": [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }],
};

let mockConfigured = true;

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: vi.fn(() => mockConfigured),
  getServerSupabase: vi.fn(() => {
    if (!mockConfigured) return null;
    return {
      from: (table: string) => {
        if (table === "feedback_feed") {
          const chain = {
            filters: {} as Record<string, unknown>,
            select() {
              return chain;
            },
            eq(col: string, val: unknown) {
              chain.filters[col] = val;
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              const rows = ALL_ROWS.filter(
                (r) => chain.filters.user_id === undefined || r.user_id === chain.filters.user_id,
              );
              return Promise.resolve({ data: rows, error: null });
            },
          };
          return chain;
        }
        if (table === "feedback") {
          return {
            select: () => ({
              in: (_col: string, ids: string[]) => {
                const rows = ids.map((id) => ({ id, cart_items: CART_ITEMS[id] ?? null }));
                return Promise.resolve({ data: rows, error: null });
              },
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }),
}));

const mockGetConsumablesSummaries = vi.fn(async (_ids: string[]) => new Map());

vi.mock("@/lib/consumablesOrder", () => ({
  getConsumablesSummaries: mockGetConsumablesSummaries,
}));

function myFeedbackRequest(token = "seller-a-token") {
  mockSessionCookieValue = token;
  return new Request("http://localhost/api/my-feedback");
}

describe("GET /api/my-feedback", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfigured = true;
    mockSessionCookieValue = "seller-a-token";
    mockGetConsumablesSummaries.mockReset();
    mockGetConsumablesSummaries.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/my-feedback/route");
  }

  it("returns only the caller's own rows", async () => {
    const { GET } = await loadRoute();
    const res = await GET(myFeedbackRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows.every((r: FeedRow) => r.user_id === "seller-a-uid")).toBe(true);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const { GET } = await loadRoute();
    const res = await GET(myFeedbackRequest("bad-token"));
    expect(res.status).toBe(401);
  });

  it("does not attach consumables fields to non-consumables rows", async () => {
    const { GET } = await loadRoute();
    const res = await GET(myFeedbackRequest());
    const body = await res.json();
    for (const row of body.rows) {
      expect(row).not.toHaveProperty("item_count");
      expect(row).not.toHaveProperty("consumables_status");
    }
    // No consumables rows for this user, so the CRM must not even be queried.
    expect(mockGetConsumablesSummaries).not.toHaveBeenCalled();
  });

  it("enriches consumables rows with the live CRM status + item count", async () => {
    const CONSUMABLES_ROWS: FeedRow[] = [
      { id: "row-4", user_id: "seller-a-uid", category: "consumables_request", status: "new" },
    ];
    ALL_ROWS.length = 0;
    ALL_ROWS.push(...CONSUMABLES_ROWS);
    mockGetConsumablesSummaries.mockResolvedValue(new Map([["row-4", { status: "picking", itemCount: 2 }]]));

    const { GET } = await loadRoute();
    const res = await GET(myFeedbackRequest());
    const body = await res.json();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].consumables_status).toBe("picking");
    expect(body.rows[0].item_count).toBe(2);
    expect(mockGetConsumablesSummaries).toHaveBeenCalledWith(["row-4"]);

    // restore fixture for subsequent tests
    ALL_ROWS.length = 0;
    ALL_ROWS.push(
      { id: "row-1", user_id: "seller-a-uid", category: "missing_item", status: "new" },
      { id: "row-2", user_id: "seller-a-uid", category: "in_progress", status: "in_progress" },
      { id: "row-3", user_id: "seller-b-uid", category: "missing_item", status: "new" },
    );
  });

  it("falls back to the journal cart size when the CRM enrichment throws", async () => {
    const CONSUMABLES_ROWS: FeedRow[] = [
      { id: "row-4", user_id: "seller-a-uid", category: "consumables_request", status: "new" },
    ];
    ALL_ROWS.length = 0;
    ALL_ROWS.push(...CONSUMABLES_ROWS);
    mockGetConsumablesSummaries.mockRejectedValue(new Error("warehouse CRM unreachable"));

    const { GET } = await loadRoute();
    const res = await GET(myFeedbackRequest());
    // A CRM outage must never turn the whole cabinet into a 500.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    // Falls back to the durable journal cart (feedback.cart_items) for the count.
    expect(body.rows[0].item_count).toBe(2);
    expect(body.rows[0].consumables_status).toBeNull();

    ALL_ROWS.length = 0;
    ALL_ROWS.push(
      { id: "row-1", user_id: "seller-a-uid", category: "missing_item", status: "new" },
      { id: "row-2", user_id: "seller-a-uid", category: "in_progress", status: "in_progress" },
      { id: "row-3", user_id: "seller-b-uid", category: "missing_item", status: "new" },
    );
  });

  // Kept last: vi.doMock overrides the module for subsequent dynamic imports
  // and isn't undone by vi.resetModules(), so a differing session identity
  // here must not leak into the tests above.
  it("returns an empty list for a user with no submissions", async () => {
    vi.doMock("@/lib/session", () => ({
      SESSION_COOKIE: "fbgb_session",
      verifySession: vi.fn(async () => ({
        uid: "seller-c-uid",
        full_name: "Seller C",
        role: "seller",
        store_id: 12,
      })),
    }));
    const { GET } = await loadRoute();
    const res = await GET(myFeedbackRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
  });
});
