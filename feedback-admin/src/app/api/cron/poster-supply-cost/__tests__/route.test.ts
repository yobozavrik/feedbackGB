import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkCronAuth, syncPosterSupplyCosts } = vi.hoisted(() => ({
  checkCronAuth: vi.fn(), syncPosterSupplyCosts: vi.fn(),
}));
vi.mock("@/lib/cronAuth", () => ({ checkCronAuth }));
vi.mock("@/lib/admin/posterSupplySync", () => ({ syncPosterSupplyCosts }));

import { GET } from "../route";

const originalVercelEnv = process.env.VERCEL_ENV;
const request = new Request("https://example.test/api/cron/poster-supply-cost");

beforeEach(() => {
  checkCronAuth.mockReset().mockReturnValue({ ok: true });
  syncPosterSupplyCosts.mockReset().mockResolvedValue({ status: "completed", expected: 1, remaining: 0 });
  process.env.VERCEL_ENV = "production";
});

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("Poster supply cron route", () => {
  it("rejects calls without cron authorization and does not sync", async () => {
    checkCronAuth.mockReturnValue({ ok: false, error: "unauthorized", status: 401 });
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
  });

  it("never writes from Preview even with valid cron authorization", async () => {
    process.env.VERCEL_ENV = "preview";
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true });
    expect(syncPosterSupplyCosts).not.toHaveBeenCalled();
  });

  it("runs the sync in Production", async () => {
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "completed" });
    expect(syncPosterSupplyCosts).toHaveBeenCalledOnce();
  });

  it("reports a missing migration as 503", async () => {
    syncPosterSupplyCosts.mockRejectedValue(new Error("schema_missing"));
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "schema_missing" });
  });

  it("does not expose internal errors in the HTTP response", async () => {
    syncPosterSupplyCosts.mockRejectedValue(new Error("internal secret"));
    const response = await GET(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "supply_sync_failed" });
  });
});
