import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCronAuth } from "../cronAuth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/daily-report", { headers });
}

describe("checkCronAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authorizes a request with the correct bearer token", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-value");
    const result = checkCronAuth(req({ authorization: "Bearer s3cr3t-value" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a request with the wrong bearer token (same length as the real secret)", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-value");
    const result = checkCronAuth(req({ authorization: "Bearer wrong-guess!" }));
    expect(result).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });

  it("rejects a request with a bearer token of a different length than the real secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-value");
    const result = checkCronAuth(req({ authorization: "Bearer short" }));
    expect(result).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });

  it("rejects a request missing the Authorization header entirely", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-value");
    const result = checkCronAuth(req());
    expect(result).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });

  it("rejects a header that isn't a Bearer token", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-value");
    const result = checkCronAuth(req({ authorization: "Basic s3cr3t-value" }));
    expect(result).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });

  it("allows the request when CRON_SECRET is unset outside production", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    const result = checkCronAuth(req());
    expect(result.ok).toBe(true);
  });

  it("allows Vercel's own cron call in production when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const result = checkCronAuth(req({ "x-vercel-cron": "1" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a non-Vercel-cron call in production when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const result = checkCronAuth(req());
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "cron_secret_not_configured",
    });
  });
});
