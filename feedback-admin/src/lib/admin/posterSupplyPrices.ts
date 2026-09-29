import type { FoodcostPeriodDays } from "./foodcostPeriod";

export type PosterSupplyDocument = {
  supplyId: number;
  supplyDate: string;
  lines: Array<{ ingredientId: number; unit: "kg" | "l" | "p"; quantity: number; sumMinor: number }>;
};

export type SupplyPricePeriod = { from: string; to: string; status: "complete" | "unavailable"; documentCount: number };
export type SupplyPriceRow = {
  ingredientId: number;
  ingredientName: string | null;
  unit: "kg" | "l" | "p";
  currentQuantity: number;
  currentSumMinor: number;
  currentSupplyCount: number;
  currentWeightedPriceMinor: number | null;
  previousWeightedPriceMinor: number | null;
  deltaMinor: number | null;
  deltaPercent: number | null;
  lastPriceMinor: number | null;
  lastSupplyDate: string | null;
  lastSupplyId: number | null;
};

export type SupplyPriceReadModel = {
  status: "complete" | "unavailable";
  reason: string | null;
  days: FoodcostPeriodDays;
  snapshot: { from: string; to: string; completedAt: string; expectedDocuments: number; fetchedDocuments: number } | null;
  current: SupplyPricePeriod;
  previous: SupplyPricePeriod;
  namedPurchasedIds: number;
  purchasedIds: number;
  rows: SupplyPriceRow[];
};

function dateAtOffset(date: string, offset: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error("invalid_supply_snapshot_date");
  return new Date(timestamp + offset * 86_400_000).toISOString().slice(0, 10);
}

export function aggregateSupplyPriceWindows(input: {
  days: FoodcostPeriodDays;
  snapshotFrom: string;
  snapshotTo: string;
  documents: PosterSupplyDocument[];
  names: Map<number, string>;
}): SupplyPriceReadModel {
  const { days, snapshotFrom, snapshotTo, documents, names } = input;
  const currentFrom = dateAtOffset(snapshotTo, -(days - 1));
  const previousTo = dateAtOffset(currentFrom, -1);
  const previousFrom = dateAtOffset(previousTo, -(days - 1));
  const currentAvailable = currentFrom >= snapshotFrom;
  const previousAvailable = previousFrom >= snapshotFrom;
  const allSupplyIds = new Set<number>();
  const hasInvalidDocument = documents.some((doc) => {
    if (!Number.isSafeInteger(doc.supplyId) || doc.supplyId <= 0 || allSupplyIds.has(doc.supplyId) ||
      !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d$/.test(doc.supplyDate) ||
      doc.supplyDate.slice(0, 10) < snapshotFrom || doc.supplyDate.slice(0, 10) > snapshotTo) return true;
    allSupplyIds.add(doc.supplyId);
    return doc.lines.some((line) => !Number.isSafeInteger(line.ingredientId) || line.ingredientId <= 0 ||
      (line.unit !== "kg" && line.unit !== "l" && line.unit !== "p") || !Number.isFinite(line.quantity) || line.quantity <= 0 ||
      !Number.isSafeInteger(line.sumMinor) || line.sumMinor < 0);
  });
  if (hasInvalidDocument) return { status: "unavailable", reason: "snapshot_contains_invalid_lines", days, snapshot: null,
    current: { from: currentFrom, to: snapshotTo, status: "unavailable", documentCount: 0 },
    previous: { from: previousFrom, to: previousTo, status: "unavailable", documentCount: 0 },
    namedPurchasedIds: 0, purchasedIds: 0, rows: [] };
  const currentDocs = currentAvailable ? documents.filter((doc) => doc.supplyDate.slice(0, 10) >= currentFrom && doc.supplyDate.slice(0, 10) <= snapshotTo) : [];
  const previousDocs = previousAvailable ? documents.filter((doc) => doc.supplyDate.slice(0, 10) >= previousFrom && doc.supplyDate.slice(0, 10) <= previousTo) : [];
  const currentByKey = new Map<string, { id: number; unit: PosterSupplyDocument["lines"][number]["unit"]; quantity: number; sum: number; supplyIds: Set<number> }>();
  const previousByKey = new Map<string, { quantity: number; sum: number }>();
  const allByKey = new Map<string, Array<{ date: string; supplyId: number; quantity: number; sum: number }>>();
  const purchasedIds = new Set<number>();
  // Keep separate typed aggregation paths so the period supply count is distinct by invoice.
  for (const doc of currentDocs) {
    for (const line of doc.lines) {
      if (!Number.isSafeInteger(line.ingredientId) || line.ingredientId <= 0 || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.sumMinor) || line.sumMinor < 0) continue;
      const key = `${line.ingredientId}:${line.unit}`; purchasedIds.add(line.ingredientId);
      const row = currentByKey.get(key) ?? { id: line.ingredientId, unit: line.unit, quantity: 0, sum: 0, supplyIds: new Set<number>() };
      row.quantity += line.quantity; row.sum += line.sumMinor; row.supplyIds.add(doc.supplyId); currentByKey.set(key, row);
    }
  }
  for (const doc of previousDocs) for (const line of doc.lines) {
    if (!Number.isSafeInteger(line.ingredientId) || line.ingredientId <= 0 || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.sumMinor) || line.sumMinor < 0) continue;
    const key = `${line.ingredientId}:${line.unit}`; purchasedIds.add(line.ingredientId);
    const row = previousByKey.get(key) ?? { quantity: 0, sum: 0 }; row.quantity += line.quantity; row.sum += line.sumMinor; previousByKey.set(key, row);
  }
  for (const doc of documents) {
    const byInvoice = new Map<string, { quantity: number; sum: number }>();
    for (const line of doc.lines) {
      if (!Number.isSafeInteger(line.ingredientId) || line.ingredientId <= 0 || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.sumMinor) || line.sumMinor < 0) continue;
      const key = `${line.ingredientId}:${line.unit}`;
      const row = byInvoice.get(key) ?? { quantity: 0, sum: 0 }; row.quantity += line.quantity; row.sum += line.sumMinor; byInvoice.set(key, row);
    }
    for (const [key, row] of byInvoice) {
      const [id] = key.split(":");
      const list = allByKey.get(key) ?? [];
      list.push({ date: doc.supplyDate, supplyId: doc.supplyId, quantity: row.quantity, sum: row.sum }); allByKey.set(key, list);
      purchasedIds.add(Number(id));
    }
  }
  const keys = new Set([...currentByKey.keys(), ...previousByKey.keys(), ...allByKey.keys()]);
  const rows: SupplyPriceRow[] = [...keys].map((key) => {
    const [rawId, unit] = key.split(":"); const id = Number(rawId);
    const current = currentByKey.get(key); const previous = previousByKey.get(key);
    // Display is 2 decimal UAH (= 1 minor unit). Compare and filter at that same precision,
    // otherwise sub-kopeck float noise can be shown as +0.00 and classified as an increase.
    const currentWeighted = current && current.quantity > 0 ? Math.round(current.sum / current.quantity) : null;
    const previousWeighted = previous && previous.quantity > 0 ? Math.round(previous.sum / previous.quantity) : null;
    const latest = [...(allByKey.get(key) ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.supplyId - a.supplyId)[0];
    return { ingredientId: id, ingredientName: names.get(id) ?? null, unit: unit as SupplyPriceRow["unit"],
      currentQuantity: current?.quantity ?? 0, currentSumMinor: current?.sum ?? 0,
      currentSupplyCount: current?.supplyIds.size ?? 0, currentWeightedPriceMinor: currentWeighted,
      previousWeightedPriceMinor: previousWeighted,
      deltaMinor: currentWeighted !== null && previousWeighted !== null ? currentWeighted - previousWeighted : null,
      deltaPercent: currentWeighted !== null && previousWeighted !== null && previousWeighted !== 0
        ? ((currentWeighted - previousWeighted) / previousWeighted) * 100 : null,
      lastPriceMinor: latest && latest.quantity > 0 ? latest.sum / latest.quantity : null,
      lastSupplyDate: latest?.date ?? null, lastSupplyId: latest?.supplyId ?? null };
  }).sort((a, b) => b.currentSumMinor - a.currentSumMinor || a.ingredientId - b.ingredientId || a.unit.localeCompare(b.unit));
  return { status: currentAvailable ? "complete" : "unavailable", reason: currentAvailable ? null : "snapshot_window_unavailable", days,
    snapshot: null,
    current: { from: currentFrom, to: snapshotTo, status: currentAvailable ? "complete" : "unavailable", documentCount: currentDocs.length },
    previous: { from: previousFrom, to: previousTo, status: previousAvailable ? "complete" : "unavailable", documentCount: previousDocs.length },
    namedPurchasedIds: [...purchasedIds].filter((id) => names.has(id)).length, purchasedIds: purchasedIds.size, rows: currentAvailable ? rows : [] };
}
