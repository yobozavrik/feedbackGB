import { describe, expect, it, vi } from "vitest";
import { publishPosterReceiptBundle, receiptArchiveConfig, ReceiptBundle } from "../posterReceiptPublication";
const bundle = { run_id: "test-run", source_count: 2 } as ReceiptBundle;
const success = { data: { run_id: "test-run", status: "accepted", receipt_count: 2, replayed: false }, error: null };
const sleep = vi.fn(async () => {});
describe("receipt atomic RPC publisher", () => {
  it("stays disabled before calling a writer", async () => { const rpc = vi.fn(); await expect(publishPosterReceiptBundle(bundle, rpc, { enabled: false })).rejects.toThrow("receipt_publishing_disabled"); expect(rpc).not.toHaveBeenCalled(); });
  it("accepts only the matching accepted run/count", async () => expect(await publishPosterReceiptBundle(bundle, vi.fn().mockResolvedValue(success), { enabled: true })).toMatchObject({ status: "accepted", receiptCount: 2, attempts: 1 }));
  it("retries exact same object on transport ambiguity", async () => { const rpc = vi.fn().mockRejectedValueOnce(new Error("SECRET PRIVATE")).mockResolvedValue({ ...success, data: { ...success.data, replayed: true } }); const result = await publishPosterReceiptBundle(bundle, rpc, { enabled: true, sleep }); expect(result.replayed).toBe(true); expect(rpc.mock.calls[0][0]).toBe(bundle); expect(rpc.mock.calls[1][0]).toBe(bundle); });
  it("bounds ambiguous network retries and does not claim failure means no commit", async () => { const rpc = vi.fn().mockRejectedValue(new Error("SECRET")); await expect(publishPosterReceiptBundle(bundle, rpc, { enabled: true, sleep })).rejects.toThrow("receipt_publish_outcome_unknown"); expect(rpc).toHaveBeenCalledTimes(3); });
  it("does not retry policy disabled", async () => { const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "receipt_ingestion_disabled" } }); await expect(publishPosterReceiptBundle(bundle, rpc, { enabled: true })).rejects.toThrow("receipt_ingestion_disabled"); expect(rpc).toHaveBeenCalledTimes(1); });
  it("does not retry conflicting manifests", async () => { const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "receipt_run_conflict" } }); await expect(publishPosterReceiptBundle(bundle, rpc, { enabled: true })).rejects.toThrow("receipt_run_conflict"); expect(rpc).toHaveBeenCalledTimes(1); });
  it.each(["42P01", "42883", "PGRST202"])("maps absent schema %s", async code => { await expect(publishPosterReceiptBundle(bundle, vi.fn().mockResolvedValue({ data: null, error: { code, message: "PRIVATE" } }), { enabled: true })).rejects.toThrow("receipt_schema_missing"); });
  it.each(["40001", "40P01"])("retries concurrency abort %s", async code => { const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { code } }).mockResolvedValue(success); expect((await publishPosterReceiptBundle(bundle, rpc, { enabled: true, sleep })).attempts).toBe(2); });
  it.each([{ ...success.data, run_id: "other" }, { ...success.data, receipt_count: 1 }, { ...success.data, status: "staging" }, { ...success.data, replayed: null }, null, []])("rejects malformed/incorrect completion response", async data => await expect(publishPosterReceiptBundle(bundle, vi.fn().mockResolvedValue({ data, error: null }), { enabled: true })).rejects.toThrow("receipt_publish_response_invalid"));
  it("redacts unexpected SQL errors", async () => await expect(publishPosterReceiptBundle(bundle, vi.fn().mockResolvedValue({ data: null, error: { code: "12345", message: "PRIVATE SECRET" } }), { enabled: true })).rejects.toThrow("receipt_publish_failed"));
  it("exposes only safe timeout code/status, not SQL detail", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, status: 500, error: { code: "57014", message: "PRIVATE SOURCE" } });
    await expect(publishPosterReceiptBundle(bundle, rpc, { enabled: true })).rejects.toMatchObject({ message: "receipt_publish_timeout", sqlState: "57014", httpStatus: 500 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("redacts unsafe error codes and never carries a raw error body", async () => {
    try { await publishPosterReceiptBundle(bundle, vi.fn().mockResolvedValue({ data: null, status: 500, error: { code: "PRIVATE SOURCE", message: "PRIVATE SOURCE" } }), { enabled: true }); }
    catch (e) { expect(JSON.stringify(e)).not.toContain("PRIVATE SOURCE"); expect(e).toMatchObject({ sqlState: null, httpStatus: 500 }); }
  });
  it("retries Supabase resolved status0 with the identical bundle", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, status: 0, error: { code: "", message: "PRIVATE TRANSPORT" } }).mockResolvedValue(success);
    expect((await publishPosterReceiptBundle(bundle, rpc, { enabled: true, sleep })).attempts).toBe(2);
    expect(rpc.mock.calls[0][0]).toBe(rpc.mock.calls[1][0]);
  });
  it("respects cancellation before a write", async () => { const controller = new AbortController(); controller.abort(); const rpc = vi.fn(); await expect(publishPosterReceiptBundle(bundle, rpc, { enabled: true, signal: controller.signal })).rejects.toThrow("receipt_publish_aborted"); expect(rpc).not.toHaveBeenCalled(); });
});
describe("archive key configuration", () => {
  const env = { POSTER_RECEIPT_ARCHIVE_KEY: Buffer.alloc(32, 7).toString("base64"), POSTER_RECEIPT_ARCHIVE_KEY_ID: "v1", POSTER_RECEIPT_ACCOUNT_ID: "account" };
  it("does not enable publishing by default", () => expect(receiptArchiveConfig(env).enabled).toBe(false));
  it("requires explicit true, not truthy strings", () => { expect(receiptArchiveConfig({ ...env, POSTER_RECEIPT_IMPORT_ENABLED: "false" }).enabled).toBe(false); expect(receiptArchiveConfig({ ...env, POSTER_RECEIPT_IMPORT_ENABLED: "true" }).enabled).toBe(true); });
  it.each(["POSTER_RECEIPT_ARCHIVE_KEY", "POSTER_RECEIPT_ARCHIVE_KEY_ID", "POSTER_RECEIPT_ACCOUNT_ID"])("requires %s", name => expect(() => receiptArchiveConfig({ ...env, [name]: undefined })).toThrow("receipt_config_invalid"));
  it.each(["SECRET invalid", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")])("rejects malformed key without exposing it", key => expect(() => receiptArchiveConfig({ ...env, POSTER_RECEIPT_ARCHIVE_KEY: key })).toThrow("receipt_config_invalid"));
});
