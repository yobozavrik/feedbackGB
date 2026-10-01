/**
 * READ ONLY. Verifies Poster receipt money/quantity semantics against dashboard
 * sources without printing receipt IDs, customer data, raw payloads or tokens.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const token = process.env.POSTER_TOKEN;
if (!token) throw new Error("poster_token_missing");

const dates = process.argv.slice(2);
if (!dates.length || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
  throw new Error("usage: node scripts/audit-poster-receipt-semantics.mjs YYYY-MM-DD [YYYY-MM-DD ...]");
}

const timeout = AbortSignal.timeout(180_000);

async function posterGet(method, params) {
  const url = new URL(`https://joinposter.com/api/${method}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: timeout });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("poster_semantics_source_unavailable");
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || body.error || !("response" in body)) {
    throw new Error("poster_semantics_source_invalid");
  }
  return body.response;
}

function integer(value, label) {
  const source = String(value ?? "");
  if (!/^-?\d+$/.test(source)) throw new Error(`poster_semantics_${label}_not_integer`);
  return BigInt(source);
}

function majorToMinor(value, label) {
  const source = String(value ?? "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(source);
  if (!match) throw new Error(`poster_semantics_${label}_not_major_money`);
  const sign = match[1] ? -1n : 1n;
  return sign * (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0"));
}

function quantity(value) {
  const source = String(value ?? "");
  if (!/^-?\d+(?:\.\d+)?$/.test(source)) throw new Error("poster_semantics_quantity_invalid");
  return { source, numeric: Number(source) };
}

async function receiptDay(date) {
  const first = await posterGet("transactions.getTransactions", {
    date_from: date, date_to: date, per_page: 1000, page: 1,
  });
  const count = Number(first?.count);
  if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(first?.data)) {
    throw new Error("poster_semantics_receipt_page_invalid");
  }
  const pages = Math.max(1, Math.ceil(count / 1000));
  const rows = [...first.data];
  for (let page = 2; page <= pages; page += 1) {
    const response = await posterGet("transactions.getTransactions", {
      date_from: date, date_to: date, per_page: 1000, page,
    });
    if (Number(response?.count) !== count || !Array.isArray(response?.data)) {
      throw new Error("poster_semantics_receipt_page_drift");
    }
    rows.push(...response.data);
  }
  if (rows.length !== count) throw new Error("poster_semantics_receipt_count_mismatch");
  return rows;
}

const distribution = (rows, key) => Object.fromEntries([...rows.reduce((map, row) => {
  const value = String(row[key] ?? "null");
  map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));

function signedSummary(values) {
  return values.reduce((result, value) => {
    if (value < 0) result.negative += 1;
    else if (value > 0) result.positive += 1;
    else result.zero += 1;
    return result;
  }, { positive: 0, zero: 0, negative: 0 });
}

async function auditDay(date) {
  const compact = date.replaceAll("-", "");
  const [receipts, dashboardReceipts, productSales] = await Promise.all([
    receiptDay(date),
    posterGet("dash.getTransactions", { dateFrom: compact, dateTo: compact, status: 2, timezone: "client" }),
    posterGet("dash.getProductsSales", { date_from: compact, date_to: compact }),
  ]);
  if (!Array.isArray(dashboardReceipts) || !Array.isArray(productSales)) {
    throw new Error("poster_semantics_dashboard_invalid");
  }

  const receiptById = new Map();
  const receiptPaid = [];
  const receiptSum = [];
  const linePaid = [];
  const quantities = [];
  let lineCount = 0;
  let fractionalQuantityLines = 0;
  let headerLinePaidMismatch = 0;
  for (const receipt of receipts) {
    const id = String(receipt.transaction_id ?? "");
    if (!/^\d+$/.test(id) || receiptById.has(id)) throw new Error("poster_semantics_receipt_identity_invalid");
    const paid = majorToMinor(receipt.payed_sum, "receipt_paid");
    const total = majorToMinor(receipt.sum, "receipt_sum");
    const lines = Array.isArray(receipt.products) ? receipt.products : null;
    if (!lines) throw new Error("poster_semantics_lines_invalid");
    let receiptLinePaid = 0n;
    for (const line of lines) {
      const paidLine = majorToMinor(line.payed_sum, "line_paid");
      const parsedQuantity = quantity(line.num);
      receiptLinePaid += paidLine;
      linePaid.push(paidLine);
      quantities.push(parsedQuantity.numeric);
      if (parsedQuantity.source.includes(".") && !/^\d+\.0+$/.test(parsedQuantity.source)) fractionalQuantityLines += 1;
      lineCount += 1;
    }
    if (receiptLinePaid !== paid) headerLinePaidMismatch += 1;
    receiptPaid.push(paid);
    receiptSum.push(total);
    receiptById.set(id, paid);
  }

  const dashboardById = new Map();
  for (const receipt of dashboardReceipts) {
    const id = String(receipt.transaction_id ?? "");
    if (!/^\d+$/.test(id) || dashboardById.has(id)) throw new Error("poster_semantics_dashboard_identity_invalid");
    dashboardById.set(id, integer(receipt.payed_sum, "dashboard_paid"));
  }
  const commonIds = [...receiptById.keys()].filter((id) => dashboardById.has(id));
  const pairMoneyMismatches = commonIds.filter((id) => receiptById.get(id) !== dashboardById.get(id)).length;
  const onlyReceipt = [...receiptById.keys()].filter((id) => !dashboardById.has(id)).length;
  const onlyDashboard = [...dashboardById.keys()].filter((id) => !receiptById.has(id)).length;

  const sum = (values) => values.reduce((total, value) => total + value, 0n);
  const dashboardPaid = [...dashboardById.values()];
  const productPaid = productSales.map((row) => integer(row.payed_sum, "product_paid"));
  const result = {
    date,
    source: {
      receiptCount: receipts.length,
      lineCount,
      fiscalStatus: distribution(receipts, "print_fiscal"),
      status: distribution(receipts, "status"),
      reason: distribution(receipts, "reason"),
      payType: distribution(receipts, "pay_type"),
      receiptPaidSigns: signedSummary(receiptPaid),
      receiptTotalSigns: signedSummary(receiptSum),
      linePaidSigns: signedSummary(linePaid),
      quantitySigns: signedSummary(quantities),
      fractionalQuantityLines,
      headerLinePaidMismatch,
    },
    receiptDashboardBridge: {
      dashboardCount: dashboardReceipts.length,
      commonCount: commonIds.length,
      onlyReceipt,
      onlyDashboard,
      pairMoneyMismatches,
      receiptPaidMinor: sum(receiptPaid).toString(),
      dashboardPaidMinor: sum(dashboardPaid).toString(),
      equalTotal: sum(receiptPaid) === sum(dashboardPaid),
    },
    productDashboardBridge: {
      productRows: productSales.length,
      receiptLinePaidMinor: sum(linePaid).toString(),
      dashboardProductPaidMinor: sum(productPaid).toString(),
      equalTotal: sum(linePaid) === sum(productPaid),
    },
  };
  result.gate = result.receiptDashboardBridge.onlyReceipt === 0 &&
    result.receiptDashboardBridge.onlyDashboard === 0 &&
    result.receiptDashboardBridge.pairMoneyMismatches === 0 &&
    result.receiptDashboardBridge.equalTotal &&
    result.productDashboardBridge.equalTotal
    ? "passed" : "failed";
  return result;
}

const startedAt = new Date().toISOString();
try {
  const results = [];
  for (const date of dates) results.push(await auditDay(date));
  const status = results.every((result) => result.gate === "passed") ? "passed" : "failed";
  process.stdout.write(`${JSON.stringify({ status, readOnly: true, startedAt,
    finishedAt: new Date().toISOString(), results,
    limits: [
      "No receipt IDs, customer data, raw payloads or tokens are emitted",
      "A passing money bridge does not by itself define refund eligibility",
      "Current Poster catalog names are not historical receipt snapshots",
    ] }, null, 2)}\n`);
  if (status !== "passed") process.exitCode = 2;
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const code = /^poster_semantics_[a-z_]+$/.test(message) ? message : "poster_semantics_audit_failed";
  process.stdout.write(`${JSON.stringify({ status: "failed", readOnly: true, startedAt,
    finishedAt: new Date().toISOString(), code })}\n`);
  process.exitCode = 1;
}
