import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { syncPosterSupplyCosts } = vi.hoisted(() => ({
  syncPosterSupplyCosts: vi.fn(),
}));
vi.mock("@/lib/admin/posterSupplySync", () => ({ syncPosterSupplyCosts }));

import { GET } from "../route";

const originalVercelEnv = process.env.VERCEL_ENV;
const originalSecret = process.env.CRON_SECRET;
const request = new Request("https://example.test/api/cron/poster-supply-cost");
const authorizedRequest = new Request("https://example.test/api/cron/poster-supply-cost", {
  headers: { authorization: "Bearer test-cron-secret" },
});

beforeEach(() => {
  syncPosterSupplyCosts.mockReset().mockResolvedValue({ status: "completed", expected: 1, remaining: 0 });
  process.env.VERCEL_ENV = "production";
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("Poster supply cron route", () => {
  it("rejects calls without cron authorization and does not sync", async () => {
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
  });

  it("fails closed without CRON_SECRET even for a spoofed Vercel header", async () => {
    delete process.env.CRON_SECRET;
    const spoofed = new Request(request.url, { headers: { "x-vercel-cron": "1" } });
    const response = await GET(spoofed);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cron_secret_not_configured" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
  });

  it("rejects an incorrect bearer token", async () => {
    const wrong = new Request(request.url, { headers: { authorization: "Bearer wrong-secret" } });
    expect((await GET(wrong)).status).toBe(401);
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
  });

  it("never writes from Preview even with valid cron authorization", async () => {
    process.env.VERCEL_ENV = "preview";
    const response = await GET(authorizedRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
    delete process.env.VERCEL_ENV;
    const local = await GET(request);
    expect(local.status).toBe(200);
    expect(await local.json()).toMatchObject({ skipped: true });
    expect(local.headers.get("cache-control")).toBe("no-store");
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
  });

  it("runs the sync in Production", async () => {
    const response = await GET(authorizedRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "completed" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(syncPosterSupplyCosts).toHaveBeenCalledOnce();
  });

  it("reports a missing migration as 503", async () => {
    syncPosterSupplyCosts.mockRejectedValue(new Error("schema_missing"));
    const response = await GET(authorizedRequest);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "schema_missing" });
  });

  it("does not expose internal errors in the HTTP response", async () => {
    syncPosterSupplyCosts.mockRejectedValue(new Error("internal secret"));
    const response = await GET(authorizedRequest);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "supply_sync_failed" });
  });
});
