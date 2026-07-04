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
  status: string;
}

const ALL_ROWS: FeedRow[] = [
  { id: "row-1", user_id: "seller-a-uid", status: "new" },
  { id: "row-2", user_id: "seller-a-uid", status: "in_progress" },
  { id: "row-3", user_id: "seller-b-uid", status: "new" },
];

let mockConfigured = true;

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: vi.fn(() => mockConfigured),
  getServerSupabase: vi.fn(() => {
    if (!mockConfigured) return null;
    return {
      from: (table: string) => {
        if (table !== "feedback_feed") throw new Error(`unexpected table ${table}`);
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
      },
    };
  }),
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
