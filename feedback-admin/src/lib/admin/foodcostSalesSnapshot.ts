import { parsePosterSalesRow, salesMetrics, type PosterSalesFact } from "./posterSalesMath";

export type FoodcostSalesFactInsert = {
  source_row_no: number;
  product_id: number;
  modification_id: number;
  category_id_snapshot: number | null;
  product_name_snapshot: string;
  category_name_snapshot: string | null;
  quantity: string;
  unit: string | null;
  weight_based: boolean;
  payed_sum_minor: number;
  product_profit_minor: number;
  product_profit_netto_minor: number | null;
  product_sum_minor: number | null;
  bonus_sum_minor: number | null;
  cert_sum_minor: number | null;
  discount_minor: number | null;
};

export type FoodcostSalesSnapshot = {
  facts: FoodcostSalesFactInsert[];
  sourceRowCount: number;
  payedSumMinor: number;
  productProfitMinor: number;
  productProfitNettoMinor: number | null;
};

function rawObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_sales_row");
  return input as Record<string, unknown>;
}

/**
 * Prepare one Poster spot/day response for feedbackgb.foodcost_sales_facts.
 * This function is pure: it neither calls Poster nor writes to Supabase.
 * Each Poster row keeps its original order, so modifiers are never collapsed.
 */
export function buildFoodcostSalesSnapshot(input: unknown): FoodcostSalesSnapshot {
  if (!Array.isArray(input)) throw new Error("invalid_sales_response");
  const parsed: PosterSalesFact[] = [];
  const facts = input.map((item, sourceRowNo) => {
    const raw = rawObject(item);
    const row = parsePosterSalesRow(raw);
    parsed.push(row);
    const categoryName = typeof raw.category_name === "string" && raw.category_name.trim()
      ? raw.category_name.trim() : null;
    return {
      source_row_no: sourceRowNo,
      product_id: row.productId,
      modification_id: row.modificationId,
      category_id_snapshot: row.categoryId,
      product_name_snapshot: row.productName,
      category_name_snapshot: categoryName,
      quantity: row.quantity,
      unit: row.unit,
      weight_based: row.weightBased,
      payed_sum_minor: row.payedSumMinor,
      product_profit_minor: row.productProfitMinor,
      product_profit_netto_minor: row.productProfitNettoMinor,
      product_sum_minor: row.productSumMinor,
      bonus_sum_minor: row.bonusSumMinor,
      cert_sum_minor: row.certSumMinor,
      discount_minor: row.discountMinor,
    } satisfies FoodcostSalesFactInsert;
  });
  const totals = salesMetrics(parsed);
  return {
    facts,
    sourceRowCount: facts.length,
    payedSumMinor: totals.payedSumMinor,
    productProfitMinor: totals.productProfitMinor,
    productProfitNettoMinor: totals.productProfitNettoMinor,
  };
}
