import { beforeEach, describe, expect, it, vi } from "vitest";

let cookieValue: string | undefined = "seller";
let session: { uid: string; role: "seller" | "admin" | "super_admin" } | null = {
  uid: "seller-1",
  role: "seller",
};
let user: Record<string, unknown> | null = {
  id: "seller-1",
  role: "seller",
  is_active: true,
  store_id: 11,
};
let permissions: Array<{ store_id: number }> = [{ store_id: 21 }, { store_id: 31 }, { store_id: 11 }];
let stores: Array<{ id: number; name: string }> = [
  { id: 31, name: "Рута" },
  { id: 11, name: "Шкільна" },
  { id: 21, name: "Київ" },
  { id: 99, name: "Чужий магазин" },
];
let configured = true;

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "fbgb_session",
  verifySession: vi.fn(async () => session),
}));

function queryResult<T>(data: T, error: unknown = null) {
  const result = { data, error };
  return {
    select: () => queryResult(data, error),
    eq: () => queryResult(data, error),
    is: () => queryResult(data, error),
    maybeSingle: async () => result,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
}

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => configured ? {
    from: (table: string) => {
      if (table === "users") return queryResult(user);
      if (table === "seller_store_permissions") return queryResult(permissions);
      if (table === "v_stores") return queryResult(stores);
      throw new Error(`Unexpected table: ${table}`);
    },
  } : null),
}));

async function getResponse() {
  const { GET } = await import("../route");
  return GET();
}

describe("GET /api/auth/photo-report-stores", () => {
  beforeEach(() => {
    cookieValue = "seller";
    session = { uid: "seller-1", role: "seller" };
    user = { id: "seller-1", role: "seller", is_active: true, store_id: 11 };
    permissions = [{ store_id: 21 }, { store_id: 31 }, { store_id: 11 }];
    stores = [
      { id: 31, name: "Рута" },
      { id: 11, name: "Шкільна" },
      { id: 21, name: "Київ" },
      { id: 99, name: "Чужий магазин" },
    ];
    configured = true;
  });

  it("returns the home store separately from active replacement stores", async () => {
    const response = await getResponse();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      home_store: { id: 11, name: "Шкільна" },
      replacement_stores: [
        { id: 21, name: "Київ" },
        { id: 31, name: "Рута" },
      ],
    });
  });

  it("does not duplicate the home store when it also has a replacement permission", async () => {
    permissions = [{ store_id: 11 }];
    const response = await getResponse();

    await expect(response.json()).resolves.toEqual({
      home_store: { id: 11, name: "Шкільна" },
      replacement_stores: [],
    });
  });

  it("supports a seller with replacement stores but without a home store", async () => {
    user = { id: "seller-1", role: "seller", is_active: true, store_id: null };
    permissions = [{ store_id: 31 }];
    const response = await getResponse();

    await expect(response.json()).resolves.toEqual({
      home_store: null,
      replacement_stores: [{ id: 31, name: "Рута" }],
    });
  });

  it("returns no data for an unauthenticated request", async () => {
    session = null;
    const response = await getResponse();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("does not disclose stores to a non-seller", async () => {
    session = { uid: "admin-1", role: "admin" };
    const response = await getResponse();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ home_store: null, replacement_stores: [] });
  });

  it("rejects an inactive seller without returning store data", async () => {
    user = { id: "seller-1", role: "seller", is_active: false, store_id: 11 };
    const response = await getResponse();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("returns a database error when Supabase is not configured", async () => {
    configured = false;
    const response = await getResponse();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "db_error" });
  });
});
