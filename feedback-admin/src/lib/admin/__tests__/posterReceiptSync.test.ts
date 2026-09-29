import { describe, expect, it, vi } from "vitest";
import { parseReceiptSyncArgs, syncPosterReceiptDay } from "../posterReceiptSync";
const env = { POSTER_TOKEN: "not-a-real-token", POSTER_RECEIPT_ACCOUNT_ID: "fixture" };
function deps() {
  return { getRoster: vi.fn().mockResolvedValue([{ spot_id: "1" }]), getRpc: vi.fn(() => vi.fn()),
    load: vi.fn().mockResolvedValue({ bundle: { secret: "PRIVATE" }, diagnostics: { receiptCount: 2 } }),
    publish: vi.fn().mockResolvedValue({ status: "accepted" }) };
}
describe("explicit receipt operator worker", () => {
  it("defaults to no DB writes and returns no bundle", async () => {
    const d = deps(), r = await syncPosterReceiptDay(["--date=2026-09-28"], env, d);
    expect(r.status).toBe("prepared_only"); expect(JSON.stringify(r)).not.toContain("PRIVATE");
    expect(d.getRpc).not.toHaveBeenCalled(); expect(d.publish).not.toHaveBeenCalled();
    expect(d.load.mock.calls[0][0].archiveMode).toBe("raw");
    expect(d.load.mock.calls[0][0]).not.toHaveProperty("key");
  });
  it("accepts explicit prepare-only even when env writer is on", async () => {
    const d = deps(); await syncPosterReceiptDay(["--date=2026-09-28", "--prepare-only"], { ...env, POSTER_RECEIPT_IMPORT_ENABLED: "true" }, d);
    expect(d.getRpc).not.toHaveBeenCalled();
  });
  it.each([[], ["--date=2026-09-28", "--date=2026-09-27"], ["--date=2026-09-28", "--publish", "--prepare-only"],
    ["--date=2026-09-28", "--force"], ["--date=28/09/2026"]].map(args => ({ args })))("rejects ambiguous/invalid args $args", ({ args }) => expect(() => parseReceiptSyncArgs(args)).toThrow("receipt_cli_arguments_invalid"));
  it("rejects missing account before any requests", async () => {
    const d = deps(); await expect(syncPosterReceiptDay(["--date=2026-09-28"], {}, d)).rejects.toThrow("receipt_account_config_missing");
    expect(d.getRoster).not.toHaveBeenCalled(); expect(d.getRpc).not.toHaveBeenCalled();
  });
  it("rejects disabled writer before reading source", async () => {
    const d = deps(); await expect(syncPosterReceiptDay(["--date=2026-09-28", "--publish"], env, d)).rejects.toThrow("receipt_publishing_disabled");
    expect(d.getRoster).not.toHaveBeenCalled(); expect(d.getRpc).not.toHaveBeenCalled();
  });
  it("never falls back to anon for publication", async () => {
    const d = deps(); await expect(syncPosterReceiptDay(["--date=2026-09-28", "--publish"], { ...env, POSTER_RECEIPT_IMPORT_ENABLED: "true" }, d)).rejects.toThrow("receipt_service_config_missing");
    expect(d.getRoster).not.toHaveBeenCalled(); expect(d.getRpc).not.toHaveBeenCalled();
  });
  it.each([[], [{ spot_id: 0 }], [{ spot_id: 1 }, { spot_id: "1" }], null].map(roster => ({ roster })))("rejects invalid verified roster $roster", async ({ roster }) => {
    const d = deps(); d.getRoster.mockResolvedValue(roster);
    await expect(syncPosterReceiptDay(["--date=2026-09-28"], env, d)).rejects.toThrow("receipt_roster_invalid"); expect(d.load).not.toHaveBeenCalled();
  });
  it("publishes only after complete load with both explicit gates", async () => {
    const d = deps(); const r = await syncPosterReceiptDay(["--date=2026-09-28", "--publish"], { ...env,
      POSTER_RECEIPT_IMPORT_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "fixture", NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" }, d);
    expect(r.status).toBe("accepted"); expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.getRoster.mock.invocationCallOrder[0]).toBeLessThan(d.load.mock.invocationCallOrder[0]);
    expect(d.load.mock.invocationCallOrder[0]).toBeLessThan(d.publish.mock.invocationCallOrder[0]);
  });
  it("does not publish incomplete day", async () => {
    const d = deps(); d.load.mockRejectedValue(new Error("receipt_pages_incomplete"));
    await expect(syncPosterReceiptDay(["--date=2026-09-28"], env, d)).rejects.toThrow("receipt_pages_incomplete");
    expect(d.publish).not.toHaveBeenCalled(); expect(d.load.mock.calls[0][0]).not.toHaveProperty("key");
  });
  it("uses existing POSTER_ACCOUNT without any encryption configuration", async () => {
    const d = deps(); await syncPosterReceiptDay(["--date=2026-09-28"], { POSTER_TOKEN: "fixture", POSTER_ACCOUNT: "fixture-account" }, d);
    expect(d.load.mock.calls[0][0].accountId).toBe("fixture-account");
  });
  it("respects cancellation before opening any connection", async () => {
    const d = deps(), controller = new AbortController(); controller.abort();
    await expect(syncPosterReceiptDay(["--date=2026-09-28"], env, d, controller.signal)).rejects.toThrow();
    expect(d.getRoster).not.toHaveBeenCalled(); expect(d.getRpc).not.toHaveBeenCalled();
  });
});
