import { createHash, randomUUID } from "node:crypto";
import { encryptReceiptArchive } from "./posterReceiptArchive";

type RecordValue = Record<string, unknown>;
type Projection = Record<string, string | boolean | null>;
export type ReceiptSourcePage = { bytes: Uint8Array };
export type ReceiptClientReply = { clientId: string; bytes: Uint8Array };
export type ReceiptBundleOptions = {
  accountId: string; businessDate: string; verifiedSpotIds: readonly string[];
  observedAt: string; keyId: string; key: Uint8Array;
};
export type PlainReceiptBundleOptions = Omit<ReceiptBundleOptions, "key" | "keyId">;
type ArchivePayload = Record<string, string | number | null>;
const fail = (code = "receipt_source_invalid"): never => { throw new Error(code); };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Original bytes are archived separately. Projection numbers remain exact lexical strings.
 * Never round a large JSON integer/decimal through JavaScript Number.
 */
export function parseReceiptSource(bytes: Uint8Array): unknown {
  try {
    if (!bytes.length || bytes.length > 32 * 1024 * 1024) return fail();
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Syntax-only validation: discard this potentially rounded value immediately.
    // Otherwise rewriting numeric tokens could turn illegal numeric property keys into valid JSON.
    JSON.parse(raw);
    let out = "", i = 0;
    while (i < raw.length) {
      if (raw[i] === '"') {
        const start = i++;
        while (i < raw.length) { if (raw[i] === "\\") { i += 2; continue; } if (raw[i++] === '"') break; }
        out += raw.slice(start, i);
      } else if (raw[i] === "-" || /\d/.test(raw[i])) {
        const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(i));
        if (!match) return fail();
        out += JSON.stringify(match[0]); i += match[0].length;
      } else out += raw[i++];
    }
    return JSON.parse(out);
  } catch { return fail(); }
}
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as RecordValue;
}
function id(value: unknown, allowZero = false): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || value.length > 19 ||
    BigInt(value) > 9223372036854775807n || (!allowZero && value === "0")) return fail();
  return value;
}
function count(value: unknown, max: number): number {
  const str = id(value, true), n = Number(str);
  if (!Number.isSafeInteger(n) || n > max) return fail();
  return n;
}
function envelope(bytes: Uint8Array): unknown {
  const body = object(parseReceiptSource(bytes));
  if (body.error !== undefined && body.error !== null && body.error !== false) return fail();
  if (!("response" in body)) return fail();
  return body.response;
}
const headerFields: Record<string, string> = {
  date_close: "source_date_close", date_start: "source_date_start", date_start_new: "source_date_start_new",
  client_id: "client_id", sum: "sum_source", payed_sum: "paid_source", payed_cash: "paid_cash_source",
  payed_card: "paid_card_source", payed_bonus: "paid_bonus_source", payed_cert: "paid_certificate_source",
  payed_third_party: "paid_third_party_source", payed_ewallet: "paid_ewallet_source", round_sum: "round_sum_source",
  tax_sum: "tax_sum_source", tip_sum: "tip_sum_source", tips_cash: "tips_cash_source", tips_card: "tips_card_source",
  total_profit: "total_profit_source", total_profit_netto: "total_profit_netto_source",
  discount: "discount_percent", bonus: "bonus_percent", print_fiscal: "source_fiscal_status", reason: "source_reason",
  status: "source_status", pay_type: "source_pay_type", payed_card_type: "source_card_type",
  payment_method_id: "source_payment_method_id", user_id: "source_user_id", table_id: "source_table_id",
  guests_count: "source_guests_count", service_mode: "source_service_mode", processing_status: "source_processing_status",
  auto_accept: "source_auto_accept", application_id: "source_application_id",
};
const lineFields: Record<string, string> = {
  product_id: "product_id", modification_id: "modification_id", type: "source_type", workshop_id: "source_workshop_id",
  num: "quantity_source", product_sum: "product_sum_source", payed_sum: "paid_source", bonus_sum: "bonus_source",
  bonus_accrual: "bonus_accrual_source", cert_sum: "certificate_source", product_price: "product_price_source",
  round_sum: "round_sum_source", product_cost: "cost_source", product_cost_netto: "cost_netto_source",
  product_profit: "profit_source", product_profit_netto: "profit_netto_source", fiscal_company_id: "source_fiscal_company_id",
  print_fiscal: "source_fiscal_status", tax_id: "source_tax_id", tax_type: "source_tax_type", tax_fiscal: "source_tax_fiscal",
  tax_sum: "tax_sum_source", tax_value: "tax_value_source", discount: "discount_percent",
};
function projection(source: RecordValue, fields: Record<string, string>): Projection {
  const result: Projection = {};
  for (const [from, to] of Object.entries(fields)) {
    const v = source[from];
    if (v === undefined) continue;
    if (v === null) result[to] = null;
    else if (from === "auto_accept" && typeof v === "boolean") result[to] = v;
    else if (from !== "auto_accept" && typeof v === "string" && v.length <= 256) {
      if (!from.startsWith("date_") && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) return fail();
      result[to] = v;
    }
    else return fail();
  }
  return result;
}

/** Poster has no snapshot token here. Two matching full closed-day scans are a bounded
 * stability check, NOT proof the source can never change after the second scan. */
export function assertReceiptPagesStable(first: readonly ReceiptSourcePage[], second: readonly ReceiptSourcePage[]): void {
  if (!first.length || first.length !== second.length || first.some((p, i) => !Buffer.from(p.bytes).equals(Buffer.from(second[i].bytes)))) {
    return fail("receipt_source_changed");
  }
}

export function buildPosterReceiptBundle(options: ReceiptBundleOptions, pages: readonly ReceiptSourcePage[],
  replies: readonly ReceiptClientReply[], makeId: () => string = randomUUID) {
  return buildReceiptBundle(options, pages, replies, makeId, (bytes, endpoint, payloadId) => {
    const encrypted = encryptReceiptArchive(bytes, { accountId: options.accountId, objectId: payloadId, endpoint }, options.key, options.keyId);
    return { archive_format: encrypted.format, key_id: encrypted.keyId, nonce: encrypted.nonce,
      auth_tag: encrypted.tag, ciphertext: encrypted.ciphertext };
  }, "receipt-archive-v1");
}

/** User-selected plaintext archive. Exact UTF-8 source text, NOT parsed/reserialized JSON.
 * Includes personal data: never log/return this bundle to a browser or export automatically.
 * SHA-256 detects byte changes; it provides NO confidentiality or source authentication.
 */
export function buildPlainPosterReceiptBundle(options: PlainReceiptBundleOptions, pages: readonly ReceiptSourcePage[],
  replies: readonly ReceiptClientReply[], makeId: () => string = randomUUID) {
  return buildReceiptBundle(options, pages, replies, makeId, bytes => {
    parseReceiptSource(bytes); // Valid JSON/UTF-8 and bounded input required.
    const raw = Buffer.from(bytes).toString("utf8");
    if (raw.includes("\u0000")) return fail(); // PostgreSQL text cannot contain NUL.
    return { archive_format: "raw-utf8-v1", raw_body: raw,
      source_sha256: createHash("sha256").update(bytes).digest("hex") };
  }, "receipt-raw-v1");
}

function buildReceiptBundle(options: PlainReceiptBundleOptions, pages: readonly ReceiptSourcePage[],
  replies: readonly ReceiptClientReply[], makeId: () => string,
  store: (bytes: Uint8Array, endpoint: "transactions.getTransactions" | "clients.getClient", payloadId: string) => ArchivePayload,
  parserVersion: string) {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(options.accountId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(options.businessDate) ||
    !Number.isFinite(Date.parse(options.businessDate)) || new Date(options.businessDate).toISOString().slice(0, 10) !== options.businessDate ||
    options.businessDate < "2026-01-01" || !Number.isFinite(Date.parse(options.observedAt)) ||
    new Date(options.observedAt).toISOString() !== options.observedAt) return fail();
  const spots = options.verifiedSpotIds.map(v => id(v));
  if (!spots.length || spots.length > 100 || new Set(spots).size !== spots.length) return fail();
  const seenUuid = new Set<string>();
  function nextId(): string { const value = makeId(); if (!uuidPattern.test(value) || seenUuid.has(value)) return fail(); seenUuid.add(value); return value; }
  const runId = nextId();
  const payloads: Array<Record<string, string | number | null>> = [];
  function archive(bytes: Uint8Array, endpoint: "transactions.getTransactions" | "clients.getClient", page: number | null, rows: number | null) {
    const payloadId = nextId();
    payloads.push({ id: payloadId, endpoint, source_page: page, source_item_count: rows,
      ...store(bytes, endpoint, payloadId) });
    return payloadId;
  }
  if (!pages.length || pages.length > 128) return fail("receipt_pages_incomplete");
  let total: number | undefined, perPage: number | undefined;
  const receipts: Array<{ transaction_id: string; spot_id: string; source_payload_id: string; source_row_no: number; projection: Projection; lines: Projection[] }> = [];
  const transactionIds = new Set<string>(), clientIds = new Set<string>();
  pages.forEach((page, index) => {
    const body = object(envelope(page.bytes)), info = object(body.page);
    const declared = count(body.count, 20000), size = count(info.per_page, 1000);
    if (!size || count(info.page, 128) !== index + 1 || !Array.isArray(body.data)) return fail("receipt_pages_incomplete");
    const rowCount = count(info.count, size);
    if (total === undefined) { total = declared; perPage = size; }
    if (total !== declared || perPage !== size || rowCount !== body.data.length ||
      rowCount !== Math.min(size, Math.max(0, declared - index * size))) return fail("receipt_pages_incomplete");
    const payloadId = archive(page.bytes, "transactions.getTransactions", index + 1, rowCount);
    body.data.forEach((item, row) => {
      const raw = object(item), transactionId = id(raw.transaction_id), spot = id(raw.spot_id);
      if (!spots.includes(spot)) return fail("receipt_unknown_spot");
      if (transactionIds.has(transactionId)) return fail("receipt_duplicate_transaction");
      transactionIds.add(transactionId);
      if (typeof raw.date_close !== "string" || !raw.date_close.startsWith(`${options.businessDate} `)) return fail("receipt_date_unverified");
      const client = id(raw.client_id ?? "0", true); if (client !== "0") clientIds.add(client);
      if (!Array.isArray(raw.products) || raw.products.length > 5000) return fail();
      const header = projection(raw, headerFields); header.client_id = client;
      const lines = raw.products.map(item => {
        const line = object(item); id(line.product_id); if (line.modification_id !== undefined && line.modification_id !== null) id(line.modification_id, true);
        if (typeof line.num !== "string") return fail();
        return projection(line, lineFields);
      });
      receipts.push({ transaction_id: transactionId, spot_id: spot, source_payload_id: payloadId, source_row_no: row + 1, projection: header, lines });
    });
  });
  if (total === undefined || perPage === undefined || pages.length !== Math.max(1, Math.ceil(total / perPage)) || receipts.length !== total) return fail("receipt_pages_incomplete");
  const clients: Array<{ id: string; client_id: string; source_payload_id: string }> = [];
  const seenClients = new Set<string>();
  for (const reply of replies) {
    const client = id(reply.clientId), response = envelope(reply.bytes);
    if (!clientIds.has(client) || seenClients.has(client) || !Array.isArray(response) || response.length !== 1 ||
      id(object(response[0]).client_id) !== client) return fail("receipt_client_incomplete");
    seenClients.add(client);
    clients.push({ id: nextId(), client_id: client, source_payload_id: archive(reply.bytes, "clients.getClient", null, null) });
  }
  if (seenClients.size !== clientIds.size) return fail("receipt_client_incomplete");
  const bundle = { run_id: runId, account_id: options.accountId, business_date: options.businessDate,
    spot_ids: spots, parser_version: parserVersion, observed_at: options.observedAt,
    source_count: total, page_count: pages.length, payloads, clients, receipts };
  if (Buffer.byteLength(JSON.stringify(bundle), "utf8") > 16 * 1024 * 1024) return fail("receipt_bundle_too_large");
  return bundle;
}
