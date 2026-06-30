import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../session";

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

async function makeCookie(uid: string, role: "admin" | "super_admin" | "seller") {
  return await signSession({
    uid,
    full_name: "Test Admin",
    role,
    store_id: null,
    iat: Date.now(),
  });
}

function mockRequest(url: string, cookie?: string) {
  globalThis.__mockCookie = cookie;
  return new Request(`http://localhost${url}`, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/admin/analytics/interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should block normal admin access with 403", async () => {
    const { GET } = await import("@/app/api/admin/analytics/interactions/route");
    const cookie = await makeCookie("admin-id", "admin");

    const res = await GET(mockRequest("/api/admin/analytics/interactions", cookie));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("forbidden");
  });

  it("should block anonymous access with 403", async () => {
    const { GET } = await import("@/app/api/admin/analytics/interactions/route");

    const res = await GET(mockRequest("/api/admin/analytics/interactions"));
    expect(res.status).toBe(403);
  });

  it("should allow super_admin access and query interactions table", async () => {
    const { GET } = await import("@/app/api/admin/analytics/interactions/route");
    const cookie = await makeCookie("super-id", "super_admin");

    const sampleInteractions = [
      {
        id: "1",
        page_path: "/login",
        x_ratio: 0.5,
        y_ratio: 0.6,
        users: { full_name: "John Doe" },
      },
    ];

    const mockChain: any = {
      eq: () => mockChain,
      order: () => mockChain,
      limit: async () => ({ data: sampleInteractions, error: null }),
    };

    mockFrom.mockImplementation((table) => {
      if (table === "user_interactions") {
        return {
          select: () => mockChain,
        };
      }
      return {};
    });

    const res = await GET(mockRequest("/api/admin/analytics/interactions?page_path=%2Flogin", cookie));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.interactions).toBeDefined();
    expect(json.interactions.length).toBe(1);
    expect(json.interactions[0].x_ratio).toBe(0.5);
  });
});
