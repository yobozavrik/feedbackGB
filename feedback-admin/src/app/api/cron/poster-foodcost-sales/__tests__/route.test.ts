import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { syncPosterFoodcostSalesNightly } = vi.hoisted(() => ({
  syncPosterFoodcostSalesNightly: vi.fn(),
}));
vi.mock("@/lib/admin/foodcostSalesNightlyWorker", () => ({ syncPosterFoodcostSalesNightly }));

import { GET } from "../route";

const originalEnv = process.env.VERCEL_ENV;
const originalSecret = process.env.CRON_SECRET;
const request = new Request("https://example.test/api/cron/poster-foodcost-sales");
const authorizedRequest = new Request("https://example.test/api/cron/poster-foodcost-sales", {
  headers: { authorization: "Bearer test-cron-secret" },
});

beforeEach(() => {
  syncPosterFoodcostSalesNightly.mockReset().mockResolvedValue({
    status: "partial", spotCount: 26, seededJobs: 2730,
    processedJobs: 80, completedJobs: 78, failedJobs: 2, timedOutJobs: 0, remaining: true,
    health: { expectedCells: 3120, completedCells: 390, missingCells: 2730,
      pendingJobs: 2500, runningJobs: 1, retryableJobs: 200, failedJobs: 29,
      historicalRosterVerified: false },
  });
  process.env.VERCEL_ENV = "production";
  process.env.CRON_SECRET = "test-cron-secret";
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalEnv;
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("Poster foodcost sales cron route", () => {
  it("has five bounded nightly UTC slots", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(config.crons.filter((job) => job.path === "/api/cron/poster-foodcost-sales")
      .map((job) => job.schedule)).toEqual(["10 22 * * *", "10 23 * * *", "10 0 * * *", "10 1 * * *", "10 2 * * *"]);
  });

  it("fails closed when Production has no CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cron_secret_not_configured" });
    expect(syncPosterFoodcostSalesNightly).not.toHaveBeenCalled();
  });

  it("rejects missing or spoofed authorization before sync", async () => {
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(syncPosterFoodcostSalesNightly).not.toHaveBeenCalled();
    const spoofed = new Request(request.url, { headers: { "x-vercel-cron": "1" } });
    expect((await GET(spoofed)).status).toBe(401);
    const wrongBearer = new Request(request.url, { headers: { authorization: "Bearer wrong-secret" } });
    expect((await GET(wrongBearer)).status).toBe(401);
  });

  it("never writes from Preview or a local environment", async () => {
    process.env.VERCEL_ENV = "preview";
    expect(await (await GET(request)).json()).toMatchObject({ skipped: true });
    delete process.env.VERCEL_ENV;
    expect(await (await GET(request)).json()).toMatchObject({ skipped: true });
    expect(syncPosterFoodcostSalesNightly).not.toHaveBeenCalled();
  });

  it("returns partial health without logging the batch as complete", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await GET(authorizedRequest);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: true, status: "partial", processedJobs: 80,
      completedJobs: 78, remaining: true, health: { missingCells: 2730, historicalRosterVerified: false } });
    expect(JSON.parse(String(log.mock.calls[0][0])).status).toBe("partial");
    expect(syncPosterFoodcostSalesNightly).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("reports missing migration and busy lease without leaking internal errors", async () => {
    syncPosterFoodcostSalesNightly.mockRejectedValueOnce(new Error("schema_missing"))
      .mockRejectedValueOnce(new Error("secret-bearing internal message"));
    const missing = await GET(authorizedRequest);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ ok: false, error: "schema_missing" });
    const internal = await GET(authorizedRequest);
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ ok: false, error: "foodcost_recent_sync_failed" });
  });
});
