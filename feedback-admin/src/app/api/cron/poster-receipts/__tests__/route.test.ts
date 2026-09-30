import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { syncPosterReceiptsNightly } = vi.hoisted(() => ({
  syncPosterReceiptsNightly: vi.fn(),
}));
vi.mock("@/lib/admin/posterReceiptNightlyWorker", () => ({ syncPosterReceiptsNightly }));

import { GET } from "../route";

const originalEnv = process.env.VERCEL_ENV;
const originalSecret = process.env.CRON_SECRET;
const request = new Request("https://example.test/api/cron/poster-receipts");
const authorizedRequest = new Request(request.url, {
  headers: { authorization: "Bearer test-cron-secret" },
});

beforeEach(() => {
  process.env.VERCEL_ENV = "production";
  process.env.CRON_SECRET = "test-cron-secret";
  syncPosterReceiptsNightly.mockReset().mockResolvedValue({
    status: "verified", day: "2026-09-29",
    runId: "22222222-2222-4222-8222-222222222222",
    receipts: 100, lines: 200, clients: 20, sourcePages: 1, replayed: false,
  });
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalEnv;
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  vi.restoreAllMocks();
});

describe("Poster receipt cron route", () => {
  it("has one bounded nightly slot after the other Poster workers", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(config.crons.filter((job) => job.path === "/api/cron/poster-receipts"))
      .toEqual([{ path: "/api/cron/poster-receipts", schedule: "20 3 * * *" }]);
  });

  it("never invokes the worker outside Production", async () => {
    process.env.VERCEL_ENV = "preview";
    const preview = await GET(authorizedRequest);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ ok: true, skipped: true,
      reason: "non_production_environment" });
    delete process.env.VERCEL_ENV;
    expect((await GET(request)).status).toBe(200);
    expect(syncPosterReceiptsNightly).not.toHaveBeenCalled();
  });

  it("fails closed when Production has no CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request(request.url, {
      headers: { "x-vercel-cron": "1" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cron_secret_not_configured" });
    expect(syncPosterReceiptsNightly).not.toHaveBeenCalled();
  });

  it("rejects absent, spoofed and incorrect bearer credentials", async () => {
    expect((await GET(request)).status).toBe(401);
    expect((await GET(new Request(request.url,
      { headers: { "x-vercel-cron": "1" } }))).status).toBe(401);
    expect((await GET(new Request(request.url,
      { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(syncPosterReceiptsNightly).not.toHaveBeenCalled();
  });

  it("returns only aggregate verification data and disables caching", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await GET(authorizedRequest);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: true, status: "verified",
      day: "2026-09-29", receipts: 100, lines: 200, clients: 20 });
    expect(syncPosterReceiptsNightly).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      event: "poster_receipt_cron", status: "verified", receipts: 100,
    });
  });

  it("returns configuration failures as 503 without exposing unexpected details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    syncPosterReceiptsNightly.mockRejectedValueOnce(new Error("receipt_schema_missing"))
      .mockRejectedValueOnce(new Error("PRIVATE SECRET"));
    const missing = await GET(authorizedRequest);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ ok: false, error: "receipt_schema_missing" });
    const internal = await GET(authorizedRequest);
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ ok: false, error: "receipt_cron_failed" });
  });
});
