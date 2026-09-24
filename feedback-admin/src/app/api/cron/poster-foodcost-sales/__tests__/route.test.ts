import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkCronAuth, syncPosterSalesRecentDays } = vi.hoisted(() => ({
  checkCronAuth: vi.fn(), syncPosterSalesRecentDays: vi.fn(),
}));
vi.mock("@/lib/cronAuth", () => ({ checkCronAuth }));
vi.mock("@/lib/admin/posterSalesSync", () => ({ syncPosterSalesRecentDays }));

import { GET } from "../route";

const originalEnv = process.env.VERCEL_ENV;
const request = new Request("https://example.test/api/cron/poster-foodcost-sales");

beforeEach(() => {
  checkCronAuth.mockReset().mockReturnValue({ ok: true });
  syncPosterSalesRecentDays.mockReset().mockResolvedValue({
    dates: ["2026-09-23", "2026-09-22", "2026-09-21"], spotCount: 26,
    expectedCells: 78, processedCells: 78, changedCells: 2, unchangedCells: 76,
  });
  process.env.VERCEL_ENV = "production";
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalEnv;
});

describe("Poster foodcost sales cron route", () => {
  it("rejects unauthenticated calls before sync", async () => {
    checkCronAuth.mockReturnValue({ ok: false, status: 401, error: "unauthorized" });
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(syncPosterSalesRecentDays).not.toHaveBeenCalled();
  });

  it("never writes from Preview or a local environment", async () => {
    process.env.VERCEL_ENV = "preview";
    expect(await (await GET(request)).json()).toMatchObject({ skipped: true });
    delete process.env.VERCEL_ENV;
    expect(await (await GET(request)).json()).toMatchObject({ skipped: true });
    expect(syncPosterSalesRecentDays).not.toHaveBeenCalled();
  });

  it("returns full-scope completion only after the batch resolves", async () => {
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, expectedCells: 78,
      processedCells: 78, changedCells: 2, unchangedCells: 76 });
    expect(syncPosterSalesRecentDays).toHaveBeenCalledOnce();
  });

  it("reports missing migration and busy lease without leaking internal errors", async () => {
    syncPosterSalesRecentDays.mockRejectedValueOnce(new Error("schema_missing"))
      .mockRejectedValueOnce(new Error("foodcost_sync_in_progress"))
      .mockRejectedValueOnce(new Error("foodcost_batch_in_progress"))
      .mockRejectedValueOnce(new Error("secret-bearing internal message"));
    const missing = await GET(request);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ ok: false, error: "schema_missing" });
    const busy = await GET(request);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ ok: false, error: "foodcost_sync_in_progress" });
    const batchBusy = await GET(request);
    expect(batchBusy.status).toBe(409);
    expect(await batchBusy.json()).toEqual({ ok: false, error: "foodcost_batch_in_progress" });
    const internal = await GET(request);
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ ok: false, error: "foodcost_recent_sync_failed" });
  });
});
