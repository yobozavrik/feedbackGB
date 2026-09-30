import { describe, expect, it, vi } from "vitest";
import { receiptCronCandidateDays, runPosterReceiptNightly,
  type ReceiptNightlyDependencies } from "../posterReceiptNightlyWorker";

const now = new Date("2026-09-30T09:00:00.000Z");
const owner = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const env = {
  POSTER_RECEIPT_IMPORT_ENABLED: "true",
  POSTER_TOKEN: "test-token",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  POSTER_RECEIPT_ACCOUNT_ID: "test-account",
};
const audit = { status: "verified" as const, day: "2026-09-29", runId,
  receipts: 10, lines: 20, clients: 3, sourcePages: 1 };

function deps(overrides: Partial<ReceiptNightlyDependencies> = {}): ReceiptNightlyDependencies {
  return {
    ownerToken: () => owner,
    claim: vi.fn(async (_account, day) => ({ status: "already_verified" as const,
      day, runId })),
    audit: vi.fn(async (day) => ({ ...audit, day })),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    importDay: vi.fn(async (day) => ({ ...audit, day, replayed: false })),
    ...overrides,
  };
}

describe("production receipt nightly workflow", () => {
  it("builds only the seven closed Kyiv days, oldest first", () => {
    expect(receiptCronCandidateDays(now)).toEqual([
      "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26",
      "2026-09-27", "2026-09-28", "2026-09-29",
    ]);
  });

  it("audits the latest day and does not import when the rolling window is complete", async () => {
    const d = deps();
    const result = await runPosterReceiptNightly(now, env, d);
    expect(result).toMatchObject({ status: "up_to_date", day: "2026-09-29",
      checkedDays: 7, receipts: 10 });
    expect(d.claim).toHaveBeenCalledTimes(7);
    expect(d.audit).toHaveBeenCalledWith("2026-09-29", runId, expect.any(AbortSignal));
    expect(d.importDay).not.toHaveBeenCalled();
  });

  it("claims and imports only the oldest missing day", async () => {
    const d = deps({
      claim: vi.fn(async (_account, day) => day === "2026-09-25"
        ? { status: "claimed" as const, day, attemptNo: 2 }
        : { status: "already_verified" as const, day, runId }),
      audit: vi.fn(async (day) => ({ ...audit, day })),
    });
    const result = await runPosterReceiptNightly(now, env, d);
    expect(result).toMatchObject({ status: "verified", day: "2026-09-25",
      receipts: 10, lines: 20, clients: 3 });
    expect(d.claim).toHaveBeenCalledTimes(3);
    expect(d.importDay).toHaveBeenCalledTimes(1);
    expect(d.importDay).toHaveBeenCalledWith("2026-09-25", env, expect.any(AbortSignal));
    expect(d.complete).toHaveBeenCalledTimes(1);
    expect(d.fail).not.toHaveBeenCalled();
  });

  it("does not call Poster when another worker holds the oldest missing day", async () => {
    const d = deps({ claim: vi.fn(async (_account, day) => ({
      status: "in_progress" as const, day,
    })) });
    const result = await runPosterReceiptNightly(now, env, d);
    expect(result).toEqual({ status: "in_progress", day: "2026-09-23", checkedDays: 1 });
    expect(d.importDay).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("rejects an audit that differs from the imported counts and journals a safe failure", async () => {
    const d = deps({
      claim: vi.fn(async (_account, day) => ({ status: "claimed" as const,
        day, attemptNo: 1 })),
      audit: vi.fn()
        .mockResolvedValueOnce({ ...audit, day: "2026-09-23", lines: 19 })
        .mockRejectedValueOnce(new Error("receipt_cron_audit_failed")),
    });
    await expect(runPosterReceiptNightly(now, env, d))
      .rejects.toThrow("receipt_cron_audit_mismatch");
    expect(d.fail).toHaveBeenCalledWith("test-account", "2026-09-23", owner,
      "receipt_cron_audit_mismatch", expect.any(AbortSignal));
    expect(d.complete).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous publish by auditing before recording failure", async () => {
    const d = deps({
      claim: vi.fn(async (_account, day) => ({ status: "claimed" as const,
        day, attemptNo: 1 })),
      importDay: vi.fn(async () => { throw new Error("receipt_publish_outcome_unknown"); }),
      audit: vi.fn(async (day) => ({ ...audit, day })),
    });
    const result = await runPosterReceiptNightly(now, env, d);
    expect(result).toMatchObject({ status: "verified_after_ambiguous_result",
      day: "2026-09-23", runId });
    expect(d.complete).toHaveBeenCalledTimes(1);
    expect(d.fail).not.toHaveBeenCalled();
  });

  it("records a bounded safe failure when import and recovery audit both fail", async () => {
    const d = deps({
      claim: vi.fn(async (_account, day) => ({ status: "claimed" as const,
        day, attemptNo: 1 })),
      importDay: vi.fn(async () => { throw new Error("PRIVATE SECRET"); }),
      audit: vi.fn(async () => { throw new Error("receipt_cron_audit_failed"); }),
    });
    await expect(runPosterReceiptNightly(now, env, d)).rejects.toThrow("receipt_cron_failed");
    expect(d.fail).toHaveBeenCalledWith("test-account", "2026-09-23", owner,
      "receipt_cron_failed", expect.any(AbortSignal));
  });

  it.each([
    ["flag disabled", { POSTER_RECEIPT_IMPORT_ENABLED: "false" }, "receipt_publishing_disabled"],
    ["missing token", { POSTER_TOKEN: undefined }, "receipt_token_missing"],
    ["missing service key", { SUPABASE_SERVICE_ROLE_KEY: undefined }, "receipt_service_config_missing"],
    ["unsafe account", { POSTER_RECEIPT_ACCOUNT_ID: "bad/account" }, "receipt_account_config_missing"],
  ])("fails closed for %s before any claim", async (_label, override, code) => {
    const d = deps();
    await expect(runPosterReceiptNightly(now, { ...env, ...override }, d)).rejects.toThrow(code);
    expect(d.claim).not.toHaveBeenCalled();
  });
});
