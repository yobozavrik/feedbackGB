import { describe, expect, it } from "vitest";
import { assertReceiptPagesStable, buildPosterReceiptBundle, parseReceiptSource, ReceiptBundleOptions } from "../posterReceiptBundle";
import { decryptReceiptArchive } from "../posterReceiptArchive";
const options: ReceiptBundleOptions = { accountId: "test", businessDate: "2026-09-28", verifiedSpotIds: ["1", "2"],
  observedAt: "2026-09-29T10:00:00.000Z", keyId: "v1", key: Buffer.alloc(32, 7) };
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
const line = (extra = {}) => ({ product_id: 4, modification_id: 0, num: "-1.500", product_sum: "-12.30", ...extra });
const receipt = (extra = {}) => ({ transaction_id: 123, spot_id: 1, client_id: 0, date_close: "2026-09-28 12:00:00",
  sum: "-12.30", discount: 35, bonus: 4, products: [line(), line()], ...extra });
const page = (rows = [receipt()], extra: Record<string, unknown> = {}) => ({ response: {
  count: rows.length, page: { per_page: 1000, page: 1, count: rows.length }, data: rows, ...extra } });
const build = (source: unknown = page(), clients: Array<{ clientId: string; bytes: Uint8Array }> = [], opts = options) =>
  buildPosterReceiptBundle(opts, [{ bytes: bytes(source) }], clients);
describe("receipt lossless projection parser", () => {
  it("keeps large integer, decimal precision and exponent tokens exact", () => expect(parseReceiptSource(Buffer.from('{"x":9007199254740993,"q":0.1234567890123456789,"y":1e400}')))
    .toEqual({ x: "9007199254740993", q: "0.1234567890123456789", y: "1e400" }));
  it("does not transform digits inside keys/escaped strings", () => expect(parseReceiptSource(Buffer.from('{"123":"\\\"-12.30\\\"","ok":true,"empty":null}')))
    .toEqual({ "123": '"-12.30"', ok: true, empty: null }));
  it.each(['{1:2}', '{"a":01}', '{"a":NaN}', '{"a":1,}', '"unterminated', '{} garbage', ''])
    ("rejects invalid raw JSON %s", raw => expect(() => parseReceiptSource(Buffer.from(raw))).toThrow("receipt_source_invalid"));
  it("rejects broken UTF-8", () => expect(() => parseReceiptSource(Buffer.from([0xff]))).toThrow());
});
describe("complete network-day encrypted receipt bundle", () => {
  it("keeps repeated product lines and source payment values", () => { const r = build().receipts[0]; expect(r.lines).toHaveLength(2); expect(r.lines[0].quantity_source).toBe("-1.500"); expect(r.projection.sum_source).toBe("-12.30"); expect(r.projection.discount_percent).toBe("35"); });
  it("archives full original bytes including unknown/private fields", () => {
    const raw = Buffer.from('{ "response":{"count":1,"page":{"page":1,"count":1,"per_page":1000},"data":[{"transaction_id":9007199254740993,"spot_id":1,"client_id":0,"date_close":"2026-09-28 12:00:00","secret_extra":{"comment":"PRIVATE"},"products":[]}]}}\n');
    const bundle = buildPosterReceiptBundle(options, [{ bytes: raw }], []), p = bundle.payloads[0];
    expect(bundle.receipts[0].transaction_id).toBe("9007199254740993");
    expect(JSON.stringify(bundle)).not.toContain("PRIVATE");
    const decoded = decryptReceiptArchive({ format: "aes-256-gcm-v1", keyId: String(p.key_id), nonce: String(p.nonce), tag: String(p.auth_tag), ciphertext: String(p.ciphertext) },
      { accountId: "test", objectId: String(p.id), endpoint: "transactions.getTransactions" }, options.key);
    expect(decoded).toEqual(raw);
  });
  it("does not expose private header fields in projections", () => expect(JSON.stringify(build(page([receipt({ client_phone: "PRIVATE", transaction_comment: "PRIVATE" })])))).not.toContain("PRIVATE"));
  it("retains percent vs bonus payment fields separately", () => expect(build(page([receipt({ payed_bonus: "20.50", bonus: 8 })])).receipts[0].projection).toMatchObject({ bonus_percent: "8", paid_bonus_source: "20.50" }));
  it("allows multiple stores in one returned source page", () => expect(build(page([receipt(), receipt({ transaction_id: 124, spot_id: 2 })])).receipts.map(r => r.spot_id)).toEqual(["1", "2"]));
  it("accepts confirmed empty day with a source page, not missing data", () => { const b = build(page([])); expect(b.source_count).toBe(0); expect(b.payloads).toHaveLength(1); });
  it("does not guess normalized currency, timestamp or quantity unit", () => { const b = build(); expect(b.receipts[0].projection).not.toHaveProperty("money_basis"); expect(b.receipts[0].projection).not.toHaveProperty("closed_at"); expect(b.receipts[0].lines[0]).not.toHaveProperty("quantity_unit"); });
  it("validates all pages and preserves page-relative row ordinal", () => {
    const pages = [1, 2].map(n => ({ bytes: bytes({ response: { count: 2, page: { per_page: 1, page: n, count: 1 }, data: [receipt({ transaction_id: n })] } }) }));
    const b = buildPosterReceiptBundle(options, pages, []); expect(b.page_count).toBe(2); expect(b.receipts.map(r => r.source_row_no)).toEqual([1, 1]);
  });
  it("rejects missing final page", () => expect(() => build(page([receipt()], { count: 1001 }))).toThrow("receipt_pages_incomplete"));
  it("rejects reordered pages", () => expect(() => build(page([receipt()], { page: { page: 2, count: 1, per_page: 1000 } }))).toThrow());
  it("rejects page count drift", () => expect(() => build(page([receipt()], { page: { page: 1, count: 0, per_page: 1000 } }))).toThrow());
  it("rejects source total drift between pages", () => {
    const pages = [1, 2].map(n => ({ bytes: bytes({ response: { count: n === 1 ? 2 : 3, page: { per_page: 1, page: n, count: 1 }, data: [receipt({ transaction_id: n })] } }) }));
    expect(() => buildPosterReceiptBundle(options, pages, [])).toThrow("receipt_pages_incomplete");
  });
  it("rejects duplicate transaction IDs", () => expect(() => build(page([receipt(), receipt()]))).toThrow("receipt_duplicate_transaction"));
  it("rejects unknown spot instead of dropping its receipt", () => expect(() => build(page([receipt({ spot_id: 99 })]))).toThrow("receipt_unknown_spot"));
  it("rejects wrong source date", () => expect(() => build(page([receipt({ date_close: "2026-09-27 23:00:00" })]))).toThrow("receipt_date_unverified"));
  it("rejects missing lines instead of using an empty array", () => expect(() => build(page([receipt({ products: null })]))).toThrow());
  it("rejects unsafe bigint identity", () => expect(() => build(page([receipt({ transaction_id: "9223372036854775808" })]))).toThrow());
  it("rejects floating-point identity", () => expect(() => build(page([receipt({ transaction_id: "12.5" })]))).toThrow());
  it("requires enrichment for referenced clients", () => expect(() => build(page([receipt({ client_id: 5 })]))).toThrow("receipt_client_incomplete"));
  it("encrypts client profile and connects one snapshot to multiple receipts", () => {
    const b = build(page([receipt({ client_id: 5 }), receipt({ transaction_id: 124, client_id: 5 })]), [{ clientId: "5", bytes: bytes({ response: [{ client_id: "5", phone: "PRIVATE", unknown: 1 }] }) }]);
    expect(b.clients).toHaveLength(1); expect(b.payloads).toHaveLength(2); expect(JSON.stringify(b)).not.toContain("PRIVATE");
  });
  it("rejects a different returned client ID", () => expect(() => build(page([receipt({ client_id: 5 })]), [{ clientId: "5", bytes: bytes({ response: [{ client_id: "6" }] }) }])).toThrow());
  it("rejects unrelated client profiles", () => expect(() => build(page(), [{ clientId: "5", bytes: bytes({ response: [{ client_id: "5" }] }) }])).toThrow());
  it("rejects unavailable client response rather than inventing profile", () => expect(() => build(page([receipt({ client_id: 5 })]), [{ clientId: "5", bytes: bytes({ response: [] }) }])).toThrow());
  it("rejects duplicate client reply", () => { const r = { clientId: "5", bytes: bytes({ response: [{ client_id: "5" }] }) }; expect(() => build(page([receipt({ client_id: 5 })]), [r, r])).toThrow(); });
  it("rejects error envelopes", () => expect(() => build({ error: { message: "PRIVATE" } })).toThrow("receipt_source_invalid"));
  it.each(["2026-02-30", "2025-12-31", "wrong"])("rejects invalid/out-of-contract date %s", businessDate => expect(() => build(page(), [], { ...options, businessDate })).toThrow());
  it("rejects duplicate verified spots", () => expect(() => build(page(), [], { ...options, verifiedSpotIds: ["1", "1"] })).toThrow());
  it("rejects invalid observed timestamp", () => expect(() => build(page(), [], { ...options, observedAt: "not-a-date" })).toThrow());
  it("rejects duplicate generated archive UUIDs", () => expect(() => buildPosterReceiptBundle(options, [{ bytes: bytes(page()) }], [], () => "00000000-0000-0000-0000-000000000001")).toThrow());
  it("rejects private text placed into financial projection", () => expect(() => build(page([receipt({ sum: "PRIVATE" })]))).toThrow());
  it("accepts two identical full scans", () => { const pages = [{ bytes: bytes(page()) }]; expect(() => assertReceiptPagesStable(pages, pages)).not.toThrow(); });
  it("rejects changed financial source even when count is unchanged", () => expect(() => assertReceiptPagesStable([{ bytes: bytes(page()) }], [{ bytes: bytes(page([receipt({ sum: "123" })])) }])).toThrow("receipt_source_changed"));
  it("rejects absent second scan", () => expect(() => assertReceiptPagesStable([{ bytes: bytes(page()) }], [])).toThrow());
});
