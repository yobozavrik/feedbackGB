import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildPlainPosterReceiptBundle } from "../posterReceiptBundle";
import { loadPosterReceiptDay } from "../posterReceiptLoader";
import { receiptPlainArchiveConfig } from "../posterReceiptPublication";
const options = { accountId: "fixture", businessDate: "2026-09-28", verifiedSpotIds: ["1"], observedAt: "2026-09-29T10:00:00.000Z" };
const raw = Buffer.from('{ "response": {"count":1,"page":{"per_page":1000,"page":1,"count":1},"data":[{"transaction_id":9007199254740993,"spot_id":1,"client_id":5,"date_close":"2026-09-28 12:00:00","products":[{"product_id":4,"num":0.1234567890123456789},{"product_id":4,"num":"1"}],"unknown":{"comment":"SYNTHETIC PRIVATE"}}]}}\n');
const client = Buffer.from('{"response":[{"client_id":"5","phone":"SYNTHETIC PRIVATE","unknown":null}]}');
const build = () => buildPlainPosterReceiptBundle(options, [{ bytes: raw }], [{ clientId: "5", bytes: client }]);
describe("user-selected unencrypted full source archive", () => {
  it("keeps exact original source text, whitespace and unknown fields", () => expect(Buffer.from(String(build().payloads[0].raw_body))).toEqual(raw));
  it("keeps exact original client profile", () => expect(Buffer.from(String(build().payloads[1].raw_body))).toEqual(client));
  it("computes byte SHA256 without claiming encryption", () => { const p = build().payloads[0]; expect(p.archive_format).toBe("raw-utf8-v1"); expect(p.source_sha256).toBe(createHash("sha256").update(raw).digest("hex")); });
  it.each(["key_id", "nonce", "auth_tag", "ciphertext"])("does not produce %s", field => expect(build().payloads[0]).not.toHaveProperty(field));
  it("does not round receipt identities/quantities and preserves repeated lines", () => { const r = build().receipts[0]; expect(r.transaction_id).toBe("9007199254740993"); expect(r.lines[0].quantity_source).toBe("0.1234567890123456789"); expect(r.lines).toHaveLength(2); });
  it("marks a distinct raw parser version", () => expect(build().parser_version).toBe("receipt-raw-v1"));
  it("still excludes private source fields from typed projections", () => expect(JSON.stringify(build().receipts)).not.toContain("SYNTHETIC PRIVATE"));
  it("still blocks missing referenced profiles", () => expect(() => buildPlainPosterReceiptBundle(options, [{ bytes: raw }], [])).toThrow("receipt_client_incomplete"));
  it("requires no archive key env and keeps publishing off", () => expect(receiptPlainArchiveConfig({ POSTER_ACCOUNT: "fixture" })).toEqual({ accountId: "fixture", enabled: false }));
  it("explicit namespace wins over fallback account", () => expect(receiptPlainArchiveConfig({ POSTER_ACCOUNT: "fallback", POSTER_RECEIPT_ACCOUNT_ID: "explicit" }).accountId).toBe("explicit"));
  it.each([undefined, "", "invalid/account"])("rejects absent/unsafe account %j", account => expect(() => receiptPlainArchiveConfig({ POSTER_ACCOUNT: account })).toThrow("receipt_account_config_missing"));
  it("loads raw mode with no key and returns safe diagnostics", async () => {
    const responses = [raw, raw, client];
    const r = await loadPosterReceiptDay({ ...options, archiveMode: "raw", token: "synthetic" }, {
      fetch: vi.fn(async () => new Response(responses.shift())), sleep: async () => {}, now: () => new Date(options.observedAt) });
    expect(r.bundle.payloads[0].archive_format).toBe("raw-utf8-v1");
    expect(JSON.stringify(r.diagnostics)).not.toContain("SYNTHETIC PRIVATE");
  });
});
describe("045 forward-only SQL contract", () => {
  const sql = readFileSync("supabase/045_poster_receipt_plaintext_archive.sql", "utf8");
  it("adds original text and byte integrity while retaining legacy AES", () => { expect(sql).toContain("add column raw_body text"); expect(sql).toContain("'aes-256-gcm-v1','raw-utf8-v1'"); expect(sql).toContain("source_sha256=encode(pg_catalog.sha256(convert_to(raw_body,'UTF8')),'hex')"); });
  it("does not open access or enable ingestion", () => { expect(sql).toContain("from public,anon,authenticated,service_role"); expect(sql).not.toMatch(/set enabled\s*=\s*true|disable row level security|grant select|create schema public/i); });
  it("preserves atomic publish-last, locks and replay", () => { expect(sql).toContain("'poster-receipt-run:'"); expect(sql).toContain("'poster-receipt-account:'"); expect(sql).toContain("bundle_sha256=v_hash"); expect(sql).toContain("-- Publish LAST."); });
  it("binds raw body/hash and forbids mixed plaintext/ciphertext", () => { expect(sql).toContain("is distinct from\n          encode(pg_catalog.sha256"); expect(sql).toContain("and key_id is null and nonce is null and auth_tag is null and ciphertext is null"); });
});
