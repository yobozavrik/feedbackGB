/** Pure validators for bounded, read-only history discovery. Never returns raw receipts or PII. */
export function probeIsoDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) throw new Error("probe_invalid_date");
  return value;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("probe_invalid_rows");
  }
  return value as Record<string, unknown>[];
}

function id(value: unknown): number {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error("probe_invalid_id");
  }
  return Number(value);
}

function amount(value: unknown): bigint {
  if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+$/.test(String(value)) ||
      (typeof value === "number" && !Number.isSafeInteger(value))) throw new Error("probe_invalid_money");
  return BigInt(value);
}

function sum(list: Record<string, unknown>[], field: string, optional = false): string | null {
  if (optional && list.some(row => row[field] == null || row[field] === "")) return null;
  return list.reduce((total, row) => total + amount(row[field]), 0n).toString();
}

/** transactions.getTransactions uses major currency strings in the probed account.
 * dash.getTransactions/getProductsSales use integer minor units. No float conversion. */
export function probeReceiptMajorToMinor(value: unknown): bigint {
  if (typeof value !== "string") throw new Error("probe_invalid_receipt_money");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("probe_invalid_receipt_money");
  const unsigned = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -unsigned : unsigned;
}

export function probeReceiptMoneyBridge(receipts: unknown, dashboard: unknown) {
  if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) throw new Error("probe_invalid_receipt_shape");
  const sample = rows((receipts as Record<string, unknown>).data);
  const allDashboard = rows(dashboard);
  const byId = new Map<number, Record<string, unknown>>();
  for (const row of allDashboard) {
    const receiptId = id(row.transaction_id);
    if (byId.has(receiptId)) throw new Error("probe_duplicate_receipt");
    byId.set(receiptId, row);
  }
  for (const row of sample) {
    const match = byId.get(id(row.transaction_id));
    if (!match || probeReceiptMajorToMinor(row.payed_sum) !== amount(match.payed_sum)) {
      throw new Error("probe_receipt_money_bridge_mismatch");
    }
  }
  return { sampledReceipts: sample.length, matchedReceipts: sample.length, dashboardRows: allDashboard.length,
    receiptMoneyBasis: "major_currency" as const, dashboardMoneyBasis: "minor_currency" as const,
    exactMoneyEqual: true as const, fullDayVerified: false as const };
}

export function probeSales(value: unknown) {
  const list = rows(value);
  const products = new Set<number>();
  let modifiedRows = 0;
  for (const row of list) {
    products.add(id(row.product_id));
    if (!/^\d+$/.test(String(row.modification_id)) || !Number.isSafeInteger(Number(row.modification_id))) {
      throw new Error("probe_invalid_modifier");
    }
    if (Number(row.modification_id) > 0) modifiedRows++;
    if (!/^-?\d+(\.\d+)?$/.test(String(row.count)) || !["0", "1"].includes(String(row.weight_flag))) {
      throw new Error("probe_invalid_quantity");
    }
  }
  return { rows: list.length, products: products.size, modifiedRows,
    deletedProductRows: list.filter(row => String(row.delete) === "1").length,
    negativeQuantityRows: list.filter(row => String(row.count).startsWith("-")).length,
    units: [...new Set(list.map(row => typeof row.unit === "string" ? row.unit : "missing"))].sort(),
    paidMinor: sum(list, "payed_sum"), profitMinor: sum(list, "product_profit"),
    nettoMinor: sum(list, "product_profit_netto", true),
    missingNettoRows: list.filter(row => row.product_profit_netto == null || row.product_profit_netto === "").length };
}

export function probeSpots(value: unknown) {
  const list = rows(value);
  const spotIds = list.map(row => id(row.spot_id)).sort((a, b) => a - b);
  if (!spotIds.length || spotIds.length > 100 || new Set(spotIds).size !== spotIds.length) {
    throw new Error("probe_invalid_roster");
  }
  const mappings = list.flatMap(row => {
    if (row.storages == null) return [];
    return rows(row.storages).map(storage => ({ spotId: id(row.spot_id), storageId: id(storage.storage_id) }));
  });
  return { spotIds, storageMappings: mappings,
    historicalIntervalsConfirmed: false as const };
}

export function probeSupplies(value: unknown, from: string, to: string) {
  probeIsoDate(from); probeIsoDate(to);
  if (from > to) throw new Error("probe_invalid_date_range");
  const list = rows(value);
  const seen = new Set<number>();
  for (const row of list) {
    const supplyId = id(row.supply_id);
    if (seen.has(supplyId)) throw new Error("probe_duplicate_supply");
    seen.add(supplyId); id(row.storage_id);
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(row.date) ||
        probeIsoDate(row.date.slice(0, 10)) < from || row.date.slice(0, 10) > to) {
      throw new Error("probe_supply_outside_window");
    }
    if (!["0", "1"].includes(String(row.delete))) throw new Error("probe_invalid_deleted_flag");
    amount(row.supply_sum);
  }
  const active = list.filter(row => String(row.delete) === "0");
  return { rows: list.length, active: active.length, deleted: list.length - active.length,
    activeSumMinor: sum(active, "supply_sum"),
    storageIds: [...new Set(list.map(row => id(row.storage_id)))].sort((a, b) => a - b),
    sampleSupplyId: active.length ? id(active[0].supply_id) : null };
}

export function probeSupplyLines(value: unknown) {
  const list = rows(value);
  for (const row of list) {
    id(row.ingredient_id);
    if (!/^\d+(\.\d+)?$/.test(String(row.supply_ingredient_num)) ||
        Number(row.supply_ingredient_num) <= 0 || !["kg", "l", "p"].includes(String(row.ingredient_unit))) {
      throw new Error("probe_invalid_supply_quantity");
    }
    amount(row.supply_ingredient_sum);
  }
  return { rows: list.length, sumMinor: sum(list, "supply_ingredient_sum"),
    units: [...new Set(list.map(row => String(row.ingredient_unit)))].sort() };
}

export function probeReceiptPage(value: unknown, expectedPage: number, perPage: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("probe_invalid_receipt_shape");
  const body = value as Record<string, unknown>;
  const list = rows(body.data);
  const page = body.page as Record<string, unknown> | undefined;
  const count = Number(body.count);
  if (!page || !Number.isSafeInteger(count) || count < 0 || Number(page.page) !== expectedPage ||
      Number(page.per_page) !== perPage || Number(page.count) !== list.length ||
      list.length > perPage || list.length > count) throw new Error("probe_invalid_receipt_page");
  const seen = new Set<number>();
  let productRows = 0;
  for (const row of list) {
    const receiptId = id(row.transaction_id);
    if (seen.has(receiptId)) throw new Error("probe_duplicate_receipt");
    seen.add(receiptId); id(row.spot_id);
    productRows += rows(row.products).length;
  }
  return { totalDeclared: count, page: expectedPage, perPage, sampledReceipts: list.length, productRows,
    receiptMoneyBasis: "major_currency" as const,
    sampledPaidMinor: list.reduce((total, row) => total + probeReceiptMajorToMinor(row.payed_sum), 0n).toString(),
    sampledSpotIds: [...new Set(list.map(row => id(row.spot_id)))].sort((a, b) => a - b),
    sampledFiscalReturns: list.filter(row => String(row.print_fiscal) === "2").length,
    fullDayVerified: false as const };
}
