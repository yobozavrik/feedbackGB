import { describe, expect, it, vi } from "vitest";
import { loadPosterReceiptDay, ReceiptLoadOptions } from "../posterReceiptLoader";
const options: ReceiptLoadOptions = { accountId: "test", businessDate: "2026-09-28", verifiedSpotIds: ["1", "2"],
  keyId: "v1", key: Buffer.alloc(32, 7), token: "SECRET-DO-NOT-LOG" };
const now = () => new Date("2026-09-29T10:00:00.000Z");
const receipt = (extra = {}) => ({ transaction_id: 123, spot_id: 1, client_id: 0, date_close: "2026-09-28 12:00:00", sum: "12.30", products: [{ product_id: 4, num: 1 }], ...extra });
const page = (rows = [receipt()], extra = {}) => ({ response: { count: rows.length, page: { per_page: 1000, page: 1, count: rows.length }, data: rows, ...extra } });
function mocks(responses: Array<unknown | Response | Error>) {
  const fetch = vi.fn(async () => { const result = responses.shift(); if (result instanceof Error) throw result;
    if (result instanceof Response) return result; return new Response(JSON.stringify(result), { status: 200 }); });
  const sleep = vi.fn(async () => {});
  return { fetch: fetch as unknown as typeof globalThis.fetch, sleep, now };
}
describe("bounded full Poster receipt loader", () => {
  it("makes two identical full scans and no database calls", async () => { const deps = mocks([page(), page()]); const r = await loadPosterReceiptDay(options, deps); expect(r.diagnostics.receiptCount).toBe(1); expect(r.diagnostics.requests).toBe(2); expect(r.diagnostics.scanStability).toBe("two_identical_scans"); });
  it("requests documented dates/page/per_page without a made-up spot filter", async () => { const deps = mocks([page(), page()]); await loadPosterReceiptDay(options, deps); const url = new URL(String(vi.mocked(deps.fetch).mock.calls[0][0])); expect(url.searchParams.get("date_from")).toBe(options.businessDate); expect(url.searchParams.has("spot_id")).toBe(false); expect(url.searchParams.get("per_page")).toBe("1000"); });
  it("returns only safe summary diagnostics", async () => { const r = await loadPosterReceiptDay(options, mocks([page(), page()])); expect(JSON.stringify(r.diagnostics)).not.toContain("SECRET"); expect(r.diagnostics).not.toHaveProperty("bundle"); });
  it("fetches each referenced client once, with optional1C field", async () => {
    const p = page([receipt({ client_id: 5 }), receipt({ transaction_id: 124, client_id: 5 })]);
    const deps = mocks([p, p, { response: [{ client_id: "5", phone: "PRIVATE" }] }]); const r = await loadPosterReceiptDay(options, deps);
    expect(r.diagnostics.clientSnapshots).toBe(1); expect(JSON.stringify(r.bundle)).not.toContain("PRIVATE");
    const url = new URL(String(vi.mocked(deps.fetch).mock.calls[2][0])); expect(url.pathname).toContain("clients.getClient"); expect(url.searchParams.get("1c")).toBe("true");
  });
  it("rejects changed source before client requests", async () => { const deps = mocks([page(), page([receipt({ sum: "99" })])]); await expect(loadPosterReceiptDay(options, deps)).rejects.toThrow("receipt_source_changed"); expect(deps.fetch).toHaveBeenCalledTimes(2); });
  it("loads all pages on both passes", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => receipt({ transaction_id: i + 1 }));
    const p1 = page(rows, { count: 1001 }), p2 = page([receipt({ transaction_id: 1001 })], { count: 1001, page: { page: 2, per_page: 1000, count: 1 } });
    const deps = mocks([p1, p2, p1, p2]); const r = await loadPosterReceiptDay(options, deps); expect(r.diagnostics.sourcePages).toBe(2); expect(r.bundle.receipts).toHaveLength(1001); expect(deps.fetch).toHaveBeenCalledTimes(4);
  });
  it("rejects page total drift", async () => { const p1 = page(Array.from({ length: 1000 }, (_, i) => receipt({ transaction_id: i + 1 })), { count: 1001 }); const p2 = page([], { count: 1000, page: { page: 2, per_page: 1000, count: 0 } }); await expect(loadPosterReceiptDay(options, mocks([p1, p2]))).rejects.toThrow("receipt_pages_incomplete"); });
  it("treats confirmed empty day differently from missing response", async () => { const r = await loadPosterReceiptDay(options, mocks([page([]), page([])])); expect(r.diagnostics.receiptCount).toBe(0); expect(r.bundle.payloads).toHaveLength(1); });
  it("rejects missing response instead of zero sales", async () => { await expect(loadPosterReceiptDay(options, mocks([{}]))).rejects.toThrow("receipt_source_invalid"); });
  it("retries transient429 and uses bounded delay", async () => { const deps = mocks([new Response("PRIVATE", { status: 429 }), page(), page()]); const r = await loadPosterReceiptDay(options, deps); expect(r.diagnostics.requests).toBe(3); expect(deps.sleep).toHaveBeenCalledWith(1000, expect.any(AbortSignal)); });
  it("retries network errors without leaking URLs/tokens", async () => { const deps = mocks([new Error("PRIVATE SECRET https://url"), page(), page()]); expect((await loadPosterReceiptDay(options, deps)).diagnostics.requests).toBe(3); });
  it("bounds network retries", async () => { const deps = mocks([new Error("PRIVATE"), new Error("PRIVATE"), new Error("PRIVATE")]); await expect(loadPosterReceiptDay(options, deps)).rejects.toThrow("receipt_source_unavailable"); expect(deps.fetch).toHaveBeenCalledTimes(3); });
  it("does not retry401 or archive error body", async () => { const deps = mocks([new Response("PRIVATE SECRET", { status: 401 })]); await expect(loadPosterReceiptDay(options, deps)).rejects.toThrow("receipt_source_unavailable"); expect(deps.fetch).toHaveBeenCalledTimes(1); });
  it("rejects200error envelope without leaking fields", async () => { await expect(loadPosterReceiptDay(options, mocks([{ error: "PRIVATE SECRET" }]))).rejects.toThrow("receipt_source_invalid"); });
  it("rejects oversized content-length before reading body", async () => { const r = new Response("PRIVATE", { headers: { "content-length": String(32 * 1024 * 1024 + 1) } }); await expect(loadPosterReceiptDay(options, mocks([r]))).rejects.toThrow("receipt_response_too_large"); });
  it("rejects missing referenced client, not an invented guest", async () => { const p = page([receipt({ client_id: 5 })]); await expect(loadPosterReceiptDay(options, mocks([p, p, { response: [] }]))).rejects.toThrow("receipt_client_incomplete"); });
  it("rejects unknown spot without silently filtering it", async () => { const p = page([receipt({ spot_id: 99 })]); await expect(loadPosterReceiptDay(options, mocks([p, p]))).rejects.toThrow("receipt_unknown_spot"); });
  it.each(["2026-09-29", "2026-09-30", "2026-02-30", "2025-12-31"])("rejects invalid/open/out-of-history day %s before network", async businessDate => { const deps = mocks([]); await expect(loadPosterReceiptDay({ ...options, businessDate }, deps)).rejects.toThrow("receipt_day_not_closed"); expect(deps.fetch).not.toHaveBeenCalled(); });
  it("rejects missing secret before network", async () => { const deps = mocks([]); await expect(loadPosterReceiptDay({ ...options, token: "" }, deps)).rejects.toThrow("receipt_config_invalid"); expect(deps.fetch).not.toHaveBeenCalled(); });
  it("respects caller cancellation without any request", async () => { const controller = new AbortController(); controller.abort(); const deps = mocks([]); await expect(loadPosterReceiptDay({ ...options, signal: controller.signal }, deps)).rejects.toThrow("receipt_load_aborted"); expect(deps.fetch).not.toHaveBeenCalled(); });
  it("disables redirects to prevent token forwarding", async () => { const deps = mocks([page(), page()]); await loadPosterReceiptDay(options, deps); expect(vi.mocked(deps.fetch).mock.calls[0][1]?.redirect).toBe("error"); });
  it("fails a known insufficient budget before fetching any client", async () => {
    const p = page([receipt({ client_id: 5 })]), deps = mocks([p, p]);
    try { await loadPosterReceiptDay({ ...options, requestBudget: 2 }, deps); expect.fail("must fail"); }
    catch (e) { expect(e).toMatchObject({ code: "receipt_request_budget_exceeded", progress: { distinctClients: 1, completedClientSnapshots: 0 } }); }
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, 20001, 2.5])("rejects invalid request budget %s", async requestBudget => await expect(loadPosterReceiptDay({ ...options, requestBudget }, mocks([]))).rejects.toThrow("receipt_config_invalid"));
  it("bounds the offline timeout", async () => await expect(loadPosterReceiptDay({ ...options, timeoutMs: 1800001 }, mocks([]))).rejects.toThrow("receipt_config_invalid"));
});
