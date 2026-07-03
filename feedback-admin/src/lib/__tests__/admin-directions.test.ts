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
vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

const mockLogAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  logAudit: mockLogAudit,
  ipFromRequest: vi.fn(() => "127.0.0.1"),
  uaFromRequest: vi.fn(() => "test-ua"),
}));

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const SELLER_USER_ID = "22222222-2222-2222-2222-222222222222";
const DIRECTION_ID = "33333333-3333-3333-3333-333333333333";
const MISSING_DIRECTION_ID = "44444444-4444-4444-4444-444444444444";

async function makeCookie(uid: string, role: "admin" | "super_admin" | "seller") {
  return await signSession({
    uid,
    full_name: "Test User",
    role,
    store_id: null,
    iat: Date.now(),
  });
}

function getRequest(cookie?: string) {
  globalThis.__mockCookie = cookie;
  return new Request("http://localhost/api/admin/directions");
}

function postRequest(body: unknown, cookie?: string) {
  globalThis.__mockCookie = cookie;
  return new Request("http://localhost/api/admin/directions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(id: string, body: unknown, cookie?: string) {
  globalThis.__mockCookie = cookie;
  return new Request(`http://localhost/api/admin/directions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** users table row used to validate an assignee (admin_id) in POST/PATCH. */
const ACTIVE_ADMIN_USER = { id: ADMIN_ID, role: "admin", is_active: true };

describe("directions API", () => {
  let adminCookie: string;
  let superAdminCookie: string;
  let sellerCookie: string;

  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    adminCookie = await makeCookie("session-admin-id", "admin");
    superAdminCookie = await makeCookie("session-super-admin-id", "super_admin");
    sellerCookie = await makeCookie("session-seller-id", "seller");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.__mockCookie = undefined;
  });

  describe("GET /api/admin/directions", () => {
    async function loadRoute() {
      return await import("@/app/api/admin/directions/route");
    }

    it("returns 403 for sellers", async () => {
      const { GET } = await loadRoute();
      globalThis.__mockCookie = sellerCookie;
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("returns directions joined with admin/category/store names for admins", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "admin_directions") {
          return {
            select: () => ({
              order: async () => ({
                data: [
                  {
                    id: DIRECTION_ID,
                    admin_id: ADMIN_ID,
                    category: "defect",
                    store_id: 11,
                    is_active: true,
                    created_at: "2026-07-01T00:00:00.000Z",
                    updated_at: "2026-07-01T00:00:00.000Z",
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "users") {
          return { select: async () => ({ data: [{ id: ADMIN_ID, full_name: "Оля" }] }) };
        }
        if (table === "categories") {
          return { select: async () => ({ data: [{ id: "defect", title: "Брак товару" }] }) };
        }
        if (table === "v_stores") {
          return { select: async () => ({ data: [{ id: 11, name: "Store 11" }] }) };
        }
        return {};
      });

      globalThis.__mockCookie = adminCookie;
      const { GET } = await loadRoute();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.directions).toEqual([
        {
          id: DIRECTION_ID,
          admin_id: ADMIN_ID,
          admin_full_name: "Оля",
          category: "defect",
          category_title: "Брак товару",
          store_id: 11,
          store_name: "Store 11",
          is_active: true,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      ]);
    });
  });

  describe("POST /api/admin/directions", () => {
    async function loadRoute() {
      return await import("@/app/api/admin/directions/route");
    }

    function mockTables(overrides: {
      userRow?: unknown;
      categoryRow?: unknown;
      storeRow?: unknown;
      insertResult?: { data: unknown; error: unknown };
    }) {
      mockFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: overrides.userRow ?? ACTIVE_ADMIN_USER,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "categories") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: "categoryRow" in overrides ? overrides.categoryRow : { id: "defect" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "v_stores") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: "storeRow" in overrides ? overrides.storeRow : { id: 11 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "admin_directions") {
          return {
            insert: () => ({
              select: () => ({
                single: async () =>
                  overrides.insertResult ?? { data: { id: DIRECTION_ID }, error: null },
              }),
            }),
          };
        }
        return {};
      });
    }

    it("returns 403 for regular admins (super_admin required)", async () => {
      mockTables({});
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: ADMIN_ID, category: "defect", store_id: null }, adminCookie),
      );
      expect(res.status).toBe(403);
    });

    it("returns 400 bad_admin_id for a malformed uuid", async () => {
      mockTables({});
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: "not-a-uuid", category: "defect" }, superAdminCookie),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_admin_id");
    });

    it("returns 400 bad_admin_id when the target user is a seller, not admin-tier", async () => {
      mockTables({ userRow: { id: SELLER_USER_ID, role: "seller", is_active: true } });
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: SELLER_USER_ID, category: "defect" }, superAdminCookie),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_admin_id");
    });

    it("returns 400 bad_admin_id when the target admin is deactivated", async () => {
      mockTables({ userRow: { id: ADMIN_ID, role: "admin", is_active: false } });
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: ADMIN_ID, category: "defect" }, superAdminCookie),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_admin_id");
    });

    it("returns 400 bad_category for a category not in feedbackgb.categories", async () => {
      mockTables({ categoryRow: null });
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: ADMIN_ID, category: "not_a_real_category" }, superAdminCookie),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_category");
    });

    it("returns 400 bad_store_id for a store not in v_stores", async () => {
      mockTables({ storeRow: null });
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: ADMIN_ID, category: "defect", store_id: 999 }, superAdminCookie),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_store_id");
    });

    it("creates the rule and writes admin.direction.create audit on success", async () => {
      mockTables({});
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: ADMIN_ID, category: "defect", store_id: 11 }, superAdminCookie),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.id).toBe(DIRECTION_ID);
      expect(mockLogAudit).toHaveBeenCalledWith(
        "admin.direction.create",
        expect.objectContaining({ meta: expect.objectContaining({ category: "defect", store_id: 11 }) }),
      );
    });

    it("returns 409 scope_conflict on a unique-index violation (23505)", async () => {
      mockTables({ insertResult: { data: null, error: { code: "23505" } } });
      const { POST } = await loadRoute();
      const res = await POST(
        postRequest({ admin_id: ADMIN_ID, category: "defect", store_id: null }, superAdminCookie),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("scope_conflict");
      expect(mockLogAudit).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/admin/directions/[id]", () => {
    async function loadRoute() {
      return await import("@/app/api/admin/directions/[id]/route");
    }

    function mockTables(overrides: {
      existing?: unknown;
      updateResult?: { error: unknown };
    }) {
      mockFrom.mockImplementation((table: string) => {
        if (table === "admin_directions") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data:
                    "existing" in overrides
                      ? overrides.existing
                      : { id: DIRECTION_ID, is_active: true },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => overrides.updateResult ?? { error: null },
            }),
          };
        }
        // store_id / category edits in the tests below re-validate against
        // v_stores / categories, same as the create endpoint.
        if (table === "v_stores") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 12 }, error: null }) }) }),
          };
        }
        if (table === "categories") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "defect" }, error: null }) }) }),
          };
        }
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: ACTIVE_ADMIN_USER, error: null }) }),
            }),
          };
        }
        return {};
      });
    }

    it("returns 403 for regular admins (super_admin required)", async () => {
      mockTables({});
      const { PATCH } = await loadRoute();
      const res = await PATCH(patchRequest(DIRECTION_ID, { is_active: false }, adminCookie), {
        params: { id: DIRECTION_ID },
      });
      expect(res.status).toBe(403);
    });

    it("returns 400 bad_id for a malformed uuid", async () => {
      mockTables({});
      const { PATCH } = await loadRoute();
      const res = await PATCH(patchRequest("not-a-uuid", { is_active: false }, superAdminCookie), {
        params: { id: "not-a-uuid" },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_id");
    });

    it("returns 404 when the direction does not exist", async () => {
      mockTables({ existing: null });
      const { PATCH } = await loadRoute();
      const res = await PATCH(
        patchRequest(MISSING_DIRECTION_ID, { is_active: false }, superAdminCookie),
        { params: { id: MISSING_DIRECTION_ID } },
      );
      expect(res.status).toBe(404);
    });

    it("soft-deletes (is_active: false) and logs admin.direction.deactivate", async () => {
      mockTables({ existing: { id: DIRECTION_ID, is_active: true } });
      const { PATCH } = await loadRoute();
      const res = await PATCH(patchRequest(DIRECTION_ID, { is_active: false }, superAdminCookie), {
        params: { id: DIRECTION_ID },
      });
      expect(res.status).toBe(200);
      expect(mockLogAudit).toHaveBeenCalledWith(
        "admin.direction.deactivate",
        expect.objectContaining({ meta: expect.objectContaining({ direction_id: DIRECTION_ID }) }),
      );
    });

    it("logs admin.direction.update for a non-deactivating edit", async () => {
      mockTables({ existing: { id: DIRECTION_ID, is_active: true } });
      const { PATCH } = await loadRoute();
      const res = await PATCH(patchRequest(DIRECTION_ID, { store_id: 12 }, superAdminCookie), {
        params: { id: DIRECTION_ID },
      });
      expect(res.status).toBe(200);
      expect(mockLogAudit).toHaveBeenCalledWith(
        "admin.direction.update",
        expect.anything(),
      );
    });

    it("returns 409 scope_conflict on a unique-index violation (23505)", async () => {
      mockTables({
        existing: { id: DIRECTION_ID, is_active: true },
        updateResult: { error: { code: "23505" } },
      });
      const { PATCH } = await loadRoute();
      const res = await PATCH(patchRequest(DIRECTION_ID, { store_id: 12 }, superAdminCookie), {
        params: { id: DIRECTION_ID },
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("scope_conflict");
    });

    it("returns 400 nothing_to_update for an empty body", async () => {
      mockTables({});
      const { PATCH } = await loadRoute();
      const res = await PATCH(patchRequest(DIRECTION_ID, {}, superAdminCookie), {
        params: { id: DIRECTION_ID },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("nothing_to_update");
    });
  });
});
