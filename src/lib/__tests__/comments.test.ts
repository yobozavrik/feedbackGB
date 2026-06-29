import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../session";

// Declare mock global variable
declare global {
  var __mockCookie: string | undefined;
}

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      if (name === "fbgb_session") {
        return { value: globalThis.__mockCookie };
      }
      return undefined;
    },
  }),
}));

// Mock Supabase
vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => null),
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(async () => true),
}));

const SAMPLE_FEEDBACK_ID = "33333333-3333-3333-3333-333333333333";

function commentsRequest(method: "GET" | "POST", body: unknown, cookieValue?: string) {
  globalThis.__mockCookie = cookieValue;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  return new Request(`http://localhost/api/admin/feedback/${SAMPLE_FEEDBACK_ID}/comments`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function fakeSupabase(selectResult: any[] | null, insertResult: any = null) {
  const selectMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: selectResult, error: null }),
    }),
  });

  const insertMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: insertResult, error: null }),
    }),
  });

  const maybeSingleMock = vi.fn().mockResolvedValue({
    data: { tg_user_id: 12345, summary: "Мало молока" },
    error: null,
  });

  const feedbackMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: maybeSingleMock,
      }),
    }),
  });

  return {
    from: vi.fn((table: string) => {
      if (table === "feedback_comments") {
        return {
          select: selectMock,
          insert: insertMock,
        };
      }
      if (table === "feedback") {
        return feedbackMock();
      }
      return null;
    }),
  };
}

describe("GET /api/admin/feedback/[id]/comments", () => {
  let adminCookie: string;
  let sellerCookie: string;

  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    adminCookie = await signSession({
      uid: "admin-uuid",
      full_name: "Адмін 1",
      role: "admin",
      store_id: null,
      iat: Date.now(),
    });
    sellerCookie = await signSession({
      uid: "seller-uuid",
      full_name: "Магазин 1",
      role: "seller",
      store_id: 1,
      iat: Date.now(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.__mockCookie = undefined;
  });

  async function loadRoute() {
    return await import("@/app/api/admin/feedback/[id]/comments/route");
  }

  it("returns 403 for non-admins (sellers)", async () => {
    const { GET } = await loadRoute();
    const res = await GET(commentsRequest("GET", null, sellerCookie), {
      params: { id: SAMPLE_FEEDBACK_ID },
    });
    expect(res.status).toBe(403);
  });

  it("returns comments list on GET for admins", async () => {
    const supabase = await import("@/lib/supabase");
    const fake = fakeSupabase([
      {
        id: "c1",
        feedback_id: SAMPLE_FEEDBACK_ID,
        author_id: "admin-uuid",
        body: "Test comment",
        created_at: new Date().toISOString(),
        author: { full_name: "Адмін 1", role: "admin" },
      },
    ]);
    vi.mocked(supabase.getServerSupabase).mockReturnValue(fake as any);

    const { GET } = await loadRoute();
    const res = await GET(commentsRequest("GET", null, adminCookie), {
      params: { id: SAMPLE_FEEDBACK_ID },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].author_name).toBe("Адмін 1");
    expect(body.comments[0].body).toBe("Test comment");
  });
});

describe("POST /api/admin/feedback/[id]/comments", () => {
  let adminCookie: string;

  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    adminCookie = await signSession({
      uid: "admin-uuid",
      full_name: "Адмін 1",
      role: "admin",
      store_id: null,
      iat: Date.now(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.__mockCookie = undefined;
  });

  async function loadRoute() {
    return await import("@/app/api/admin/feedback/[id]/comments/route");
  }

  it("creates comment and triggers telegram notification on POST", async () => {
    const supabase = await import("@/lib/supabase");
    const telegram = await import("@/lib/telegram");

    const insertedComment = {
      id: "new-c",
      feedback_id: SAMPLE_FEEDBACK_ID,
      author_id: "admin-uuid",
      body: "Hello seller",
      created_at: new Date().toISOString(),
    };

    const fake = fakeSupabase(null, insertedComment);
    vi.mocked(supabase.getServerSupabase).mockReturnValue(fake as any);

    const { POST } = await loadRoute();
    const res = await POST(
      commentsRequest("POST", { body: "Hello seller" }, adminCookie),
      { params: { id: SAMPLE_FEEDBACK_ID } },
    );

    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);
    expect(resBody.comment.body).toBe("Hello seller");

    // Check that Telegram notification was attempted
    expect(telegram.sendTelegramMessage).toHaveBeenCalled();
  });
});
