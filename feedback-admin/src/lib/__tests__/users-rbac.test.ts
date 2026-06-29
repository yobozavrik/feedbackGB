import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../session";

// Declare mock global cookie variable
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

const mockFrom = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
}));

// Helper to sign session cookies
async function makeCookie(uid: string, role: "admin" | "super_admin" | "seller") {
  return await signSession({
    uid,
    full_name: "Test User",
    role,
    store_id: null,
    iat: Date.now(),
  });
}

function mockRequest(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, cookie?: string) {
  globalThis.__mockCookie = cookie;
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Users CRUD API & RBAC Checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/admin/users (Create User)", () => {
    it("should allow super_admin to create another admin", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const cookie = await makeCookie("super-id", "super_admin");

      mockFrom.mockImplementation((table) => {
        if (table === "users") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "new-user-id",
                    full_name: "Admin User",
                    display_label: "Admin Label",
                    role: "admin",
                    store_id: null,
                    is_active: true,
                    pin_hash: null,
                    failed_attempts: 0,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await POST(
        mockRequest("POST", "/api/admin/users", {
          full_name: "Admin User",
          display_label: "Admin Label",
          role: "admin",
        }, cookie)
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.user.id).toBe("new-user-id");
      expect(json.user.role).toBe("admin");
    });

    it("should deny normal admin from creating another admin", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const cookie = await makeCookie("admin-id", "admin");

      const res = await POST(
        mockRequest("POST", "/api/admin/users", {
          full_name: "Admin User",
          display_label: "Admin Label",
          role: "admin",
        }, cookie)
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Адміністратори можуть створювати лише продавчинь");
    });

    it("should require store_id for seller role", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const cookie = await makeCookie("admin-id", "admin");

      const res = await POST(
        mockRequest("POST", "/api/admin/users", {
          full_name: "Seller User",
          display_label: "Seller Label",
          role: "seller",
        }, cookie)
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("обов'язково повинна бути прикріплена до магазину");
    });

    it("should validate that store exists in v_stores for seller", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const cookie = await makeCookie("admin-id", "admin");

      mockFrom.mockImplementation((table) => {
        if (table === "v_stores") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }), // store doesn't exist
              }),
            }),
          };
        }
        return {};
      });

      const res = await POST(
        mockRequest("POST", "/api/admin/users", {
          full_name: "Seller User",
          display_label: "Seller Label",
          role: "seller",
          store_id: 999,
        }, cookie)
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Магазин не знайдено");
    });
  });

  describe("PATCH /api/admin/users/[id] (Update User)", () => {
    it("should return 400 for invalid UUID format", async () => {
      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const cookie = await makeCookie("admin-id", "admin");

      const res = await PATCH(
        mockRequest("PATCH", "/api/admin/users/invalid-uuid", {}, cookie),
        { params: { id: "invalid-uuid" } }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("UUID");
    });

    it("should deny normal admin from updating an admin", async () => {
      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const cookie = await makeCookie("admin-id", "admin");
      const targetId = "11111111-1111-1111-1111-111111111111";

      mockFrom.mockImplementation((table) => {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: targetId, role: "admin", is_active: true },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await PATCH(
        mockRequest("PATCH", `/api/admin/users/${targetId}`, { full_name: "New Name" }, cookie),
        { params: { id: targetId } }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("не можуть редагувати інших адміністраторів");
    });

    it("should deny normal admin from raising a seller to admin", async () => {
      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const cookie = await makeCookie("admin-id", "admin");
      const targetId = "22222222-2222-2222-2222-222222222222";

      mockFrom.mockImplementation((table) => {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: targetId, role: "seller", is_active: true },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await PATCH(
        mockRequest("PATCH", `/api/admin/users/${targetId}`, { role: "admin" }, cookie),
        { params: { id: targetId } }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("не можуть видавати адміністративні ролі");
    });

    it("should prevent self-deactivation", async () => {
      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const myId = "33333333-3333-3333-3333-333333333333";
      const cookie = await makeCookie(myId, "super_admin");

      mockFrom.mockImplementation((table) => {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: myId, role: "super_admin", is_active: true },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await PATCH(
        mockRequest("PATCH", `/api/admin/users/${myId}`, { is_active: false }, cookie),
        { params: { id: myId } }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("свій власний акаунт");
    });

    it("should prevent deactivating the last active super_admin", async () => {
      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const targetId = "44444444-4444-4444-4444-444444444444";
      const cookie = await makeCookie("super-admin-me", "super_admin");

      mockFrom.mockImplementation((table) => {
        if (table === "users") {
          return {
            select: (fields: string, options?: { count: string }) => {
              if (options?.count === "exact") {
                // Count active super admins
                return {
                  eq: () => ({
                    eq: async () => ({ count: 1, error: null }),
                  }),
                };
              }
              // Normal select query
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: targetId, role: "super_admin", is_active: true },
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        return {};
      });

      const res = await PATCH(
        mockRequest("PATCH", `/api/admin/users/${targetId}`, { is_active: false }, cookie),
        { params: { id: targetId } }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("останнього активного супер-адміністратора");
    });
  });

  describe("DELETE /api/admin/users/[id] (Soft Deactivate)", () => {
    it("should set is_active = false for seller", async () => {
      const { DELETE } = await import("@/app/api/admin/users/[id]/route");
      const cookie = await makeCookie("admin-me", "admin");
      const targetId = "55555555-5555-5555-5555-555555555555";

      mockFrom.mockImplementation((table) => {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: targetId, role: "seller", is_active: true },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        return {};
      });

      const res = await DELETE(
        mockRequest("DELETE", `/api/admin/users/${targetId}`, undefined, cookie),
        { params: { id: targetId } }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });
});
