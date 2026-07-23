import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialRateLimitKey, rateLimit } from "../rateLimit";
import { getServerSupabase } from "../supabase";

vi.mock("../supabase", () => ({
  getServerSupabase: vi.fn(),
}));

describe("rateLimit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should fall back to in-memory rate limiting in development when Supabase client is missing", async () => {
    vi.mocked(getServerSupabase).mockReturnValue(null);

    const key = "test-dev-fallback";
    const limit = 2;
    const windowMs = 5000;

    const res1 = await rateLimit(key, limit, windowMs);
    expect(res1.ok).toBe(true);
    expect(res1.remaining).toBe(1);

    const res2 = await rateLimit(key, limit, windowMs);
    expect(res2.ok).toBe(true);
    expect(res2.remaining).toBe(0);

    const res3 = await rateLimit(key, limit, windowMs);
    expect(res3.ok).toBe(false);
  });

  it("should fail closed in production when Supabase client is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getServerSupabase).mockReturnValue(null);

    await expect(rateLimit("test-prod-fail", 2, 5000)).rejects.toThrow(
      "Supabase client is unavailable in production rate limiter (fail-closed)."
    );
  });

  it("should query database RPC when Supabase is available", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: { ok: true, remaining: 5, reset_ms: 1000 },
      error: null,
    });

    vi.mocked(getServerSupabase).mockReturnValue({
      rpc: mockRpc,
    } as any);

    const res = await rateLimit("test-db-ok", 10, 60000);
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(5);
    expect(res.reset_ms).toBe(1000);

    expect(mockRpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "test-db-ok",
      p_limit: 10,
      p_window_seconds: 60,
    });
  });

  it("should fail closed in production if DB RPC returns an error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database offline" },
    });

    vi.mocked(getServerSupabase).mockReturnValue({
      rpc: mockRpc,
    } as any);

    await expect(rateLimit("test-db-err", 10, 60000)).rejects.toThrow(
      "DB rate limit RPC failed in production: database offline"
    );
  });
});

describe("credentialRateLimitKey", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "test-secret-at-least-16-bytes");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is deterministic for the same namespace + credential", async () => {
    const a = await credentialRateLimitKey("login:pin", "123456");
    const b = await credentialRateLimitKey("login:pin", "123456");
    expect(a).toBe(b);
  });

  it("differs for different credentials", async () => {
    const a = await credentialRateLimitKey("login:pin", "123456");
    const b = await credentialRateLimitKey("login:pin", "654321");
    expect(a).not.toBe(b);
  });

  it("differs for different namespaces given the same credential", async () => {
    // Domain separation: a future second use of this helper (different
    // namespace) must not collide with the login:pin bucket for the same
    // raw value.
    const a = await credentialRateLimitKey("login:pin", "123456");
    const b = await credentialRateLimitKey("other:thing", "123456");
    expect(a).not.toBe(b);
  });

  it("never leaks the raw credential into the returned key", async () => {
    const key = await credentialRateLimitKey("login:pin", "123456");
    expect(key).not.toContain("123456");
  });

  it("changes if SESSION_SECRET changes (keyed, not a plain hash)", async () => {
    const a = await credentialRateLimitKey("login:pin", "123456");
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret-16b");
    const b = await credentialRateLimitKey("login:pin", "123456");
    expect(a).not.toBe(b);
  });

  it("fails closed in production when SESSION_SECRET is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    await expect(credentialRateLimitKey("login:pin", "123456")).rejects.toThrow(
      /SESSION_SECRET is not set/,
    );
  });
});
