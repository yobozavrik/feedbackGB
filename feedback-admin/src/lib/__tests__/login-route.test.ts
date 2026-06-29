import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for /api/auth/login. We stub `getServerSupabase` to
 * return an in-memory fake so the handler runs to completion without
 * touching the network or a real Supabase instance.
 *
 * Goal of this suite: catch regressions in the PIN-only auth contract:
 *   1. Body must accept `{pin}` only — no `user_id` required.
 *   2. PIN must be exactly 6 digits.
 *   3. On verify_pin_global success the route mints a session cookie and
 *      mirrors the role to the response body.
 *   4. On null/malformed user the route returns 401 and writes an
 *      anonymous audit row (no targetUserId).
 *   5. The geoip + audit + users.update side-effects fire concurrently
 *      and never throw out of the handler.
 */

interface SupabaseUserRow {
  id: string;
  full_name: string;
  display_label: string | null;
  role: "seller" | "admin" | "super_admin";
  store_id: number | null;
}

const SAMPLE_USER: SupabaseUserRow = {
  id: "11111111-1111-1111-1111-111111111111",
  full_name: "Магазин 11 — ЧЕРЕМОШ (Маланюк Лариса / Морошан Марія)",
  display_label: "Магазин 11 — ЧЕРЕМОШ",
  role: "seller",
  store_id: 11,
};

const SAMPLE_ADMIN: SupabaseUserRow = {
  id: "22222222-2222-2222-2222-222222222222",
  full_name: "Супер-адмін",
  display_label: "Супер-адмін",
  role: "super_admin",
  store_id: null,
};

interface FakeQueryBuilder {
  update: (payload: unknown) => FakeQueryBuilder;
  eq: (col: string, val: unknown) => FakeQueryBuilder;
  then: (cb: (res: { error: null }) => void) => Promise<void>;
}

function fakeSupabase(rpcResult: SupabaseUserRow | null) {
  const updateCalls: Array<{ payload: unknown; id: unknown }> = [];

  const builder: FakeQueryBuilder = {
    update(payload) {
      updateCalls.push({ payload, id: undefined });
      return builder;
    },
    eq(_col, val) {
      const last = updateCalls[updateCalls.length - 1];
      if (last) last.id = val;
      return builder;
    },
    async then(cb) {
      cb({ error: null });
    },
  };

  return {
    client: {
      rpc: vi.fn(async (fn: string, params: unknown) => {
        if (fn === "verify_pin_global") {
          return { data: rpcResult, error: null };
        }
        return {
          data: null,
          error: { code: "rpc_unknown", message: `unknown rpc ${fn}` },
        };
      }),
      from: vi.fn(() => builder),
    },
    updateCalls,
  };
}

function loginRequest(body: unknown, ip = "203.0.113.99") {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      "user-agent": "vitest",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(() => null),
}));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return {
    ...actual,
    logAudit: vi.fn(async () => {}),
  };
});
vi.mock("@/lib/geoip", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geoip")>(
    "@/lib/geoip",
  );
  return {
    ...actual,
    lookupIp: vi.fn(async () => null),
  };
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    const audit = await import("@/lib/audit");
    vi.mocked(audit.logAudit).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    return await import("@/app/api/auth/login/route");
  }

  it("rejects malformed JSON with 400", async () => {
    const { POST } = await loadRoute();
    const res = await POST(loginRequest("{not json", "192.0.2.1"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid JSON");
  });

  it.each([
    ["", "empty"],
    ["abc123", "alpha"],
    ["12345", "5 digits"],
    ["1234567", "7 digits"],
    ["12 34 56", "spaces"],
  ])("rejects PIN %s (%s)", async (pin, _label) => {
    const { POST } = await loadRoute();
    const res = await POST(loginRequest({ pin }, `198.51.100.${Math.floor(Math.random() * 250) + 1}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PIN має бути 6 цифр");
  });

  it("returns 503 when Supabase is not configured", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      loginRequest({ pin: "654321" }, "198.51.100.10"),
    );
    expect(res.status).toBe(503);
  });

  it("ignores legacy user_id field (PIN alone is the credential)", async () => {
    const supabase = await import("@/lib/supabase");
    const fake = fakeSupabase(SAMPLE_USER);
    vi.mocked(supabase.getServerSupabase).mockReturnValue(
      fake.client as unknown as ReturnType<typeof supabase.getServerSupabase>,
    );

    const { POST } = await loadRoute();
    const res = await POST(
      loginRequest(
        { pin: "654321", user_id: "stale-uuid-from-old-client" },
        "198.51.100.20",
      ),
    );

    expect(res.status).toBe(200);
    expect(fake.client.rpc).toHaveBeenCalledWith("verify_pin_global", {
      p_pin: "654321",
    });
    const body = (await res.json()) as {
      ok: boolean;
      user: { uid: string; role: string };
    };
    expect(body.ok).toBe(true);
    expect(body.user.uid).toBe(SAMPLE_USER.id);
    expect(body.user.role).toBe("seller");
  });

  it("sets the session cookie on success", async () => {
    const supabase = await import("@/lib/supabase");
    const fake = fakeSupabase(SAMPLE_ADMIN);
    vi.mocked(supabase.getServerSupabase).mockReturnValue(
      fake.client as unknown as ReturnType<typeof supabase.getServerSupabase>,
    );

    const { POST } = await loadRoute();
    const res = await POST(loginRequest({ pin: "112233" }, "198.51.100.30"));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/fbgb_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const body = (await res.json()) as {
      user: { full_name: string; role: string };
    };
    expect(body.user.role).toBe("super_admin");
    // display_label preferred over full_name in the response.
    expect(body.user.full_name).toBe("Супер-адмін");
  });

  it("returns 401 with anonymous audit on missing user", async () => {
    const supabase = await import("@/lib/supabase");
    const audit = await import("@/lib/audit");
    const fake = fakeSupabase(null);
    vi.mocked(supabase.getServerSupabase).mockReturnValue(
      fake.client as unknown as ReturnType<typeof supabase.getServerSupabase>,
    );

    const { POST } = await loadRoute();
    const res = await POST(loginRequest({ pin: "999999" }, "198.51.100.40"));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Невірний PIN");

    expect(audit.logAudit).toHaveBeenCalledTimes(1);
    const [action, details] = vi.mocked(audit.logAudit).mock.calls[0];
    expect(action).toBe("auth.login.failure");
    // PIN-only flow can't attribute the failure to a user.
    expect(details).not.toHaveProperty("targetUserId");
    expect(details).not.toHaveProperty("actorUserId");
  });
});
