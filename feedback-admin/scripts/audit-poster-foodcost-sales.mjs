/** Read-only Poster sales probe. Never logs credentials, full URLs, or receipt-level data. */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const token = process.env.POSTER_TOKEN;
if (!token) throw new Error("POSTER_TOKEN is not configured");

const date = process.argv[2] ?? "2026-09-23";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
  throw new Error("Expected ISO date YYYY-MM-DD");
}
const compactDate = date.replaceAll("-", "");

async function posterGet(method, params = {}) {
  const url = new URL(`https://joinposter.com/api/${method}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(`${method}: request failed`);
  }
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || body.error || !Object.hasOwn(body, "response")) {
    throw new Error(`${method}: invalid response`);
  }
  return body.response;
}

function integer(row, field) {
  const value = Number(row[field] ?? 0);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${field} in Poster response`);
  return value;
}

function summarize(rows) {
  if (!Array.isArray(rows)) throw new Error("Expected sales array");
  const productCounts = new Map();
  const keyCounts = new Map();
  const totals = { payedSumMinor: 0, productSumMinor: 0, productProfitMinor: 0,
    productProfitNettoMinor: 0, missingProfitNettoRows: 0, bonusSumMinor: 0,
    certSumMinor: 0, discountMinor: 0, positiveDiscountMinor: 0, negativeDiscountMinor: 0,
    negativeProfitRows: 0,
    weightCount: 0, pieceCount: 0, unknownUnitRows: 0 };
  for (const row of rows) {
    const productId = String(row.product_id ?? "");
    const modifierId = String(row.modification_id ?? "0");
    if (!/^\d+$/.test(productId)) throw new Error("Invalid product_id in Poster response");
    productCounts.set(productId, (productCounts.get(productId) ?? 0) + 1);
    const key = `${productId}:${modifierId}`;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    totals.payedSumMinor += integer(row, "payed_sum");
    totals.productSumMinor += integer(row, "product_sum");
    totals.productProfitMinor += integer(row, "product_profit");
    if (row.product_profit_netto == null) totals.missingProfitNettoRows++;
    else totals.productProfitNettoMinor += integer(row, "product_profit_netto");
    totals.bonusSumMinor += integer(row, "bonus_sum");
    totals.certSumMinor += integer(row, "cert_sum");
    totals.discountMinor += integer(row, "discount");
    if (integer(row, "discount") > 0) totals.positiveDiscountMinor += integer(row, "discount");
    if (integer(row, "discount") < 0) totals.negativeDiscountMinor += integer(row, "discount");
    const count = Number(row.count);
    if (!Number.isFinite(count)) throw new Error("Invalid count in Poster response");
    if (String(row.weight_flag) === "1") totals.weightCount += count;
    else if (String(row.weight_flag) === "0") totals.pieceCount += count;
    else totals.unknownUnitRows++;
    if (integer(row, "product_profit") < 0) totals.negativeProfitRows++;
  }
  const product121 = rows.filter((row) => String(row.product_id) === "121").map((row) => ({
    productId: Number(row.product_id), modifierId: row.modification_id ?? "0",
    count: row.count, weightFlag: row.weight_flag, unit: row.unit,
    payedSumMinor: integer(row, "payed_sum"), productProfitMinor: integer(row, "product_profit"),
    bonusSumMinor: integer(row, "bonus_sum"), certSumMinor: integer(row, "cert_sum"),
    discountMinor: integer(row, "discount"),
  }));
  const pieceSample = rows.find((row) => String(row.weight_flag) === "0" && Number(row.count) > 0);
  totals.weightCount = Number(totals.weightCount.toFixed(3));
  totals.pieceCount = Number(totals.pieceCount.toFixed(3));
  return {
    rows: rows.length,
    distinctProducts: productCounts.size,
    productsWithMultipleRows: [...productCounts.values()].filter((count) => count > 1).length,
    productModifierKeysWithMultipleRows: [...keyCounts.values()].filter((count) => count > 1).length,
    ...totals,
    product121,
    pieceSample: pieceSample ? { productId: Number(pieceSample.product_id),
      modifierId: pieceSample.modification_id ?? "0", count: pieceSample.count,
      unit: pieceSample.unit, payedSumMinor: integer(pieceSample, "payed_sum") } : null,
  };
}

const spots = await posterGet("access.getSpots");
if (!Array.isArray(spots) || spots.length === 0) throw new Error("No Poster spots");
const selected = spots.find((spot) => Number.isSafeInteger(Number(spot.spot_id)) && Number(spot.spot_id) > 0);
if (!selected) throw new Error("No valid Poster spot");
const query = { date_from: compactDate, date_to: compactDate };
const [network, oneSpot] = await Promise.all([
  posterGet("dash.getProductsSales", query),
  posterGet("dash.getProductsSales", { ...query, spot_id: selected.spot_id }),
]);
const discountRows = process.argv.includes("--discount-breakdown")
  ? network.filter((row) => integer(row, "discount") !== 0).map((row) => ({
      productId: Number(row.product_id), name: row.product_name ?? row.name ?? null,
      discountMinor: integer(row, "discount"), productSumMinor: integer(row, "product_sum"),
      payedSumMinor: integer(row, "payed_sum"), bonusSumMinor: integer(row, "bonus_sum"),
    }))
  : null;
let allSpotsReconciliation = null;
let transactionsReconciliation = null;
if (process.argv.includes("--transactions")) {
  const seen = new Set();
  const transactionTotals = { checks: 0, payedSumMinor: 0, totalProfitMinor: 0,
    totalProfitNettoMinor: 0, payedBonusMinor: 0, payedCertMinor: 0,
    thirdPartyMinor: 0, roundSumMinor: 0, orderSumMinor: 0,
    missingNettoCount: 0 };
  const batch = await posterGet("dash.getTransactions", {
    dateFrom: compactDate, dateTo: compactDate, status: 2, timezone: "client",
  });
  if (!Array.isArray(batch)) throw new Error("Expected transaction array");
  for (const row of batch) {
    const id = String(row.transaction_id ?? "");
    if (!/^\d+$/.test(id) || seen.has(id)) throw new Error("Invalid or repeated transaction ID");
    seen.add(id);
    transactionTotals.checks++;
    transactionTotals.payedSumMinor += integer(row, "payed_sum");
    transactionTotals.totalProfitMinor += integer(row, "total_profit");
    if (row.total_profit_netto == null) transactionTotals.missingNettoCount++;
    else transactionTotals.totalProfitNettoMinor += integer(row, "total_profit_netto");
    transactionTotals.payedBonusMinor += integer(row, "payed_bonus");
    transactionTotals.payedCertMinor += integer(row, "payed_cert");
    transactionTotals.thirdPartyMinor += integer(row, "payed_third_party");
    transactionTotals.roundSumMinor += integer(row, "round_sum");
    transactionTotals.orderSumMinor += integer(row, "sum");
  }
  transactionsReconciliation = transactionTotals;
}
if (process.argv.includes("--all-spots")) {
  const validSpots = spots.filter((spot) => Number.isSafeInteger(Number(spot.spot_id)) && Number(spot.spot_id) > 0);
  const summaries = [];
  for (let offset = 0; offset < validSpots.length; offset += 4) {
    const batch = validSpots.slice(offset, offset + 4);
    const sales = await Promise.all(batch.map((spot) => posterGet("dash.getProductsSales", { ...query, spot_id: spot.spot_id })));
    summaries.push(...sales.map((rows, index) => ({ spotId: Number(batch[index].spot_id), ...summarize(rows) })));
  }
  const whole = summarize(network);
  const spotTotals = summaries.reduce((totals, row) => {
    totals.rows += row.rows;
    totals.payedSumMinor += row.payedSumMinor;
    totals.productSumMinor += row.productSumMinor;
    totals.productProfitMinor += row.productProfitMinor;
    totals.productProfitNettoMinor += row.productProfitNettoMinor;
    totals.bonusSumMinor += row.bonusSumMinor;
    totals.certSumMinor += row.certSumMinor;
    totals.discountMinor += row.discountMinor;
    return totals;
  }, { rows: 0, payedSumMinor: 0, productSumMinor: 0, productProfitMinor: 0,
    productProfitNettoMinor: 0, bonusSumMinor: 0, certSumMinor: 0, discountMinor: 0 });
  allSpotsReconciliation = {
    spotsQueried: summaries.length,
    spotsWithRepeatedProductModifierKey: summaries.filter((row) => row.productModifierKeysWithMultipleRows > 0).length,
    repeatedProductModifierKeys: summaries.reduce((total, row) => total + row.productModifierKeysWithMultipleRows, 0),
    networkRows: whole.rows,
    spotTotals,
    deltaNetworkMinusSpots: {
      payedSumMinor: whole.payedSumMinor - spotTotals.payedSumMinor,
      productSumMinor: whole.productSumMinor - spotTotals.productSumMinor,
      productProfitMinor: whole.productProfitMinor - spotTotals.productProfitMinor,
      productProfitNettoMinor: whole.productProfitNettoMinor - spotTotals.productProfitNettoMinor,
      bonusSumMinor: whole.bonusSumMinor - spotTotals.bonusSumMinor,
      certSumMinor: whole.certSumMinor - spotTotals.certSumMinor,
      discountMinor: whole.discountMinor - spotTotals.discountMinor,
    },
  };
}
process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), date,
  spotsAvailable: spots.length,
  selectedSpot: { id: Number(selected.spot_id), name: selected.spot_name ?? null },
  network: summarize(network), spot: summarize(oneSpot), allSpotsReconciliation,
  discountRows, transactionsReconciliation }, null, 2)}\n`);
