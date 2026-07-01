import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../session";

declare global {
  var __mockCookie: string | undefined;
}

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

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
  ipFromRequest: vi.fn(() => "127.0.0.1"),
  uaFromRequest: vi.fn(() => "test-ua"),
}));

const EXISTING_ID = "11111111-1111-1111-1111-111111111111";
const MISSING_ID = "22222222-2222-2222-2222-222222222222";

function patchRequest(id: string, body: unknown, cookie?: string) {
  globalThis.__mockCookie = cookie;
  return new Request(`http://localhost/api/admin/feedback/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeCookie(uid: string, role: "admin" | "super_admin" | "seller") {
  return await signSession({
    uid,
    full_name: "Test Admin",
    role,
    store_id: null,
    iat: Date.now(),
  });
}

describe("PATCH /api/admin/feedback/[id]", () => {
  let adminCookie: string;
  let sellerCookie: string;

  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    adminCookie = await makeCookie("admin-id", "admin");
    sellerCookie = await makeCookie("seller-id", "seller");
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.__mockCookie = undefined;
  });

  async function loadRoute() {
    return await import("@/app/api/admin/feedback/[id]/route");
  }

  it("returns 403 for non-admins (sellers)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(patchRequest(EXISTING_ID, { comment: "hi" }, sellerCookie), {
      params: { id: EXISTING_ID },
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 bad_id for a malformed id", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(patchRequest("not-a-uuid", { comment: "hi" }, adminCookie), {
      params: { id: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_id");
  });

  it("returns 404 (not 200 ok:true) when the feedback id does not exist", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "feedback") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "feedback_comments") {
        return { insert: async () => ({ data: null, error: null }) };
      }
      return {};
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      patchRequest(MISSING_ID, { comment: "should not silently succeed" }, adminCookie),
      { params: { id: MISSING_ID } },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("still succeeds (200 ok:true) when the feedback id exists", async () => {
    let updateCalled = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "feedback") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: EXISTING_ID }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => {
              updateCalled = true;
              return { error: null };
            },
          }),
        };
      }
      if (table === "feedback_comments") {
        return { insert: async () => ({ data: null, error: null }) };
      }
      return {};
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      patchRequest(EXISTING_ID, { status: "in_progress" }, adminCookie),
      { params: { id: EXISTING_ID } },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(updateCalled).toBe(true);
  });
});
