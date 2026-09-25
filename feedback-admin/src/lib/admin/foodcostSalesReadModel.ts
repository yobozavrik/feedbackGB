import { groupCategorySales, groupProductSales, salesMetrics, type CategorySales, type PosterSalesFact, type ProductSales, type SalesMetrics } from "./posterSalesMath";

export type SalesRunRead = {
  id: string;
  business_date: string;
  spot_id: number;
  status: string;
  completed_at: string | null;
  source_fetched_at: string | null;
  source_row_count: number | null;
  payed_sum_minor: number | string | null;
  product_profit_minor: number | string | null;
  product_profit_netto_minor: number | string | null;
};

export type SalesFactRead = {
  run_id: string;
  source_row_no: number;
  product_id: number;
  modification_id: number;
  category_id_snapshot: number | null;
  category_name_snapshot?: string | null;
  product_name_snapshot: string;
  quantity: string;
  unit: string | null;
  weight_based: boolean;
  payed_sum_minor: number | string;
  product_profit_minor: number | string;
  product_profit_netto_minor: number | string | null;
  product_sum_minor: number | string | null;
  bonus_sum_minor: number | string | null;
  cert_sum_minor: number | string | null;
  discount_minor: number | string | null;
};

type MissingCell = { businessDate: string; spotId: number; reason: "missing_run" | "invalid_run" };
export type SalesReadModel = {
  status: "complete" | "incomplete";
  expectedCells: number;
  completedCells: number;
  missing: MissingCell[];
  sourceFetchedAt: string | null;
  metrics: SalesMetrics | null;
  categories: (CategorySales & { categoryName: string | null; categoryNameConflict: boolean })[] | null;
  products: ProductSales[] | null;
};

function money(value: number | string | null, allowNull = false): number | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid_snapshot_money");
  if (String(value).trim() === "") throw new Error("invalid_snapshot_money");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("invalid_snapshot_money");
  return number;
}

function toFact(row: SalesFactRead): PosterSalesFact {
  return {
    productId: row.product_id,
    modificationId: row.modification_id,
    categoryId: row.category_id_snapshot,
    productName: row.product_name_snapshot,
    quantity: row.quantity,
    unit: row.unit,
    weightBased: row.weight_based,
    payedSumMinor: money(row.payed_sum_minor)!,
    productProfitMinor: money(row.product_profit_minor)!,
    productProfitNettoMinor: money(row.product_profit_netto_minor, true),
    productSumMinor: money(row.product_sum_minor, true),
    bonusSumMinor: money(row.bonus_sum_minor, true),
    certSumMinor: money(row.cert_sum_minor, true),
    discountMinor: money(row.discount_minor, true),
  };
}

/**
 * Strict day/spot coverage. An absent or corrupt cell makes network/category/
 * product KPIs unavailable, never a partial number presented as complete.
 */
export function buildFoodcostSalesReadModel(
  businessDates: readonly string[], spotIds: readonly number[],
  runs: readonly SalesRunRead[], facts: readonly SalesFactRead[],
): SalesReadModel {
  if (!businessDates.length || !spotIds.length ||
    new Set(businessDates).size !== businessDates.length || new Set(spotIds).size !== spotIds.length) {
    throw new Error("invalid_sales_scope");
  }
  const latest = new Map<string, SalesRunRead>();
  for (const run of runs) {
    if (run.status !== "completed" || !run.completed_at) continue;
    const key = `${run.business_date}:${run.spot_id}`;
    const prior = latest.get(key);
    if (!prior || run.completed_at > prior.completed_at! ||
      (run.completed_at === prior.completed_at && run.id > prior.id)) latest.set(key, run);
  }
  const factsByRun = new Map<string, SalesFactRead[]>();
  for (const fact of facts) {
    const group = factsByRun.get(fact.run_id) ?? [];
    group.push(fact);
    factsByRun.set(fact.run_id, group);
  }
  const missing: MissingCell[] = [];
  const allFacts: PosterSalesFact[] = [];
  const selectedFacts: SalesFactRead[] = [];
  const fetchedAt: string[] = [];
  let completedCells = 0;
  for (const businessDate of businessDates) for (const spotId of spotIds) {
    const run = latest.get(`${businessDate}:${spotId}`);
    if (!run) {
      missing.push({ businessDate, spotId, reason: "missing_run" });
      continue;
    }
    try {
      if (!run.source_fetched_at || run.source_row_count === null ||
        !Number.isSafeInteger(run.source_row_count) || run.source_row_count < 0) {
        throw new Error("invalid_snapshot_run");
      }
      const rows = [...(factsByRun.get(run.id) ?? [])].sort((a, b) => a.source_row_no - b.source_row_no);
      if (rows.length !== run.source_row_count || rows.some((row, index) => row.source_row_no !== index)) {
        throw new Error("invalid_snapshot_rows");
      }
      const parsed = rows.map(toFact);
      const sums = salesMetrics(parsed);
      if (sums.payedSumMinor !== money(run.payed_sum_minor) ||
        sums.productProfitMinor !== money(run.product_profit_minor) ||
        sums.productProfitNettoMinor !== money(run.product_profit_netto_minor, true)) {
        throw new Error("invalid_snapshot_totals");
      }
      allFacts.push(...parsed);
      selectedFacts.push(...rows);
      fetchedAt.push(run.source_fetched_at);
      completedCells++;
    } catch {
      missing.push({ businessDate, spotId, reason: "invalid_run" });
    }
  }
  if (missing.length) return {
    status: "incomplete", expectedCells: businessDates.length * spotIds.length,
    completedCells, missing, sourceFetchedAt: null, metrics: null, categories: null, products: null,
  };
  const categoryNames = new Map<number | null, Set<string>>();
  for (const row of selectedFacts) {
    const name = row.category_name_snapshot?.trim();
    if (!name) continue;
    const names = categoryNames.get(row.category_id_snapshot) ?? new Set<string>();
    names.add(name);
    categoryNames.set(row.category_id_snapshot, names);
  }
  const categories = groupCategorySales(allFacts).map((category) => {
    const names = categoryNames.get(category.categoryId);
    return { ...category, categoryName: names?.size === 1 ? [...names][0] : null,
      categoryNameConflict: (names?.size ?? 0) > 1 };
  });
  return {
    status: "complete", expectedCells: businessDates.length * spotIds.length,
    completedCells, missing: [], sourceFetchedAt: fetchedAt.sort()[0] ?? null,
    metrics: salesMetrics(allFacts), categories, products: groupProductSales(allFacts),
  };
}
