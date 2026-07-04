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

const FEEDBACK_ROWS: Record<string, { id: string; user_id: string; status: string }> = {
  [OWNED_ID]: { id: OWNED_ID, user_id: "seller-a-uid", status: "in_progress" },
  [OTHERS_ID]: { id: OTHERS_ID, user_id: "seller-b-uid", status: "new" },
};

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
});
