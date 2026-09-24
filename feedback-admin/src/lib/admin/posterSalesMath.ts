/**
 * Pure parsing and aggregation for Poster dash.getProductsSales.
 * Money stays in integer minor units; do not use floating-point гривні for sums.
 * Poster report reconciliation (2026-09-23): its "Прибуток" matches
 * transaction total_profit_netto, not total_profit. Keep both methodologies
 * separately named; a product-level netto sum can differ from receipts by 1 minor unit.
 */

export type PosterSalesFact = {
  productId: number;
  modificationId: number;
  categoryId: number | null;
  productName: string;
  unit: string | null;
  weightBased: boolean;
  quantity: string;
  payedSumMinor: number;
  productProfitMinor: number;
  productProfitNettoMinor: number | null;
  productSumMinor: number | null;
  bonusSumMinor: number | null;
  certSumMinor: number | null;
  discountMinor: number | null;
};

export type SalesMetrics = {
  payedSumMinor: number;
  productProfitMinor: number;
  productProfitNettoMinor: number | null;
  inferredCostMinor: number;
  nettoInferredCostMinor: number | null;
  foodCostPercent: number | null;
  nettoFoodCostPercent: number | null;
};

export type ProductSales = SalesMetrics & {
  productId: number;
  productName: string;
  categoryId: number | null;
  categoryConflict: boolean;
  unit: string | null;
  unitConflict: boolean;
  weightBased: boolean | null;
  quantity: string | null;
  modificationIds: number[];
  rows: number;
};

export type ProductPeriodComparison = {
  productId: number;
  current: ProductSales | null;
  previous: ProductSales | null;
  foodCostDeltaPoints: number | null;
  nettoFoodCostDeltaPoints: number | null;
};

export type CategorySales = SalesMetrics & {
  categoryId: number | null;
  rows: number;
  distinctProducts: number;
};

const QUANTITY_SCALE = 10_000_000n;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_sales_row");
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, allowNull = false): number | null {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    throw new Error(`invalid_${field}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid_${field}`);
  return parsed;
}

function quantityScaled(value: unknown): bigint {
  const text = String(value ?? "");
  const match = /^(-?)(\d+)(?:\.(\d{1,7}))?$/.exec(text);
  if (!match) throw new Error("invalid_count");
  return BigInt(`${match[1]}${match[2]}`) * QUANTITY_SCALE +
    (match[1] === "-" ? -1n : 1n) * BigInt((match[3] ?? "").padEnd(7, "0"));
}

function formatQuantity(scaled: bigint): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const fraction = String(absolute % QUANTITY_SCALE).padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / QUANTITY_SCALE}${fraction ? `.${fraction}` : ""}`;
}

export function parsePosterSalesRow(input: unknown): PosterSalesFact {
  const row = object(input);
  const productId = integer(row.product_id, "product_id")!;
  const modificationId = integer(row.modification_id ?? 0, "modification_id")!;
  if (productId <= 0 || modificationId < 0) throw new Error("invalid_sales_identity");
  const categoryId = integer(row.category_id, "category_id", true);
  if (categoryId !== null && categoryId <= 0) throw new Error("invalid_category_id");
  const weightFlag = String(row.weight_flag ?? "0");
  if (weightFlag !== "0" && weightFlag !== "1") throw new Error("invalid_weight_flag");
  const productName = typeof row.product_name === "string" ? row.product_name.trim() : "";
  if (!productName) throw new Error("invalid_product_name");
  const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null;
  return {
    productId, modificationId, categoryId, productName, unit,
    weightBased: weightFlag === "1",
    quantity: formatQuantity(quantityScaled(row.count)),
    payedSumMinor: integer(row.payed_sum, "payed_sum")!,
    productProfitMinor: integer(row.product_profit, "product_profit")!,
    productProfitNettoMinor: integer(row.product_profit_netto, "product_profit_netto", true),
    productSumMinor: integer(row.product_sum, "product_sum", true),
    bonusSumMinor: integer(row.bonus_sum, "bonus_sum", true),
    certSumMinor: integer(row.cert_sum, "cert_sum", true),
    discountMinor: integer(row.discount, "discount", true),
  };
}

function safeSum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error("sales_total_overflow");
  return result;
}

export function salesMetrics(rows: ReadonlyArray<Pick<PosterSalesFact, "payedSumMinor" | "productProfitMinor"> &
  { productProfitNettoMinor?: number | null }>): SalesMetrics {
  let payedSumMinor = 0;
  let productProfitMinor = 0;
  let productProfitNettoMinor = 0;
  let nettoComplete = true;
  for (const row of rows) {
    payedSumMinor = safeSum(payedSumMinor, row.payedSumMinor);
    productProfitMinor = safeSum(productProfitMinor, row.productProfitMinor);
    if (row.productProfitNettoMinor == null) nettoComplete = false;
    else productProfitNettoMinor = safeSum(productProfitNettoMinor, row.productProfitNettoMinor);
  }
  const inferredCostMinor = safeSum(payedSumMinor, -productProfitMinor);
  const nettoInferredCostMinor = nettoComplete ? safeSum(payedSumMinor, -productProfitNettoMinor) : null;
  return {
    payedSumMinor, productProfitMinor,
    productProfitNettoMinor: nettoComplete ? productProfitNettoMinor : null,
    inferredCostMinor, nettoInferredCostMinor,
    foodCostPercent: payedSumMinor > 0 ? inferredCostMinor / payedSumMinor * 100 : null,
    nettoFoodCostPercent: payedSumMinor > 0 && nettoInferredCostMinor !== null
      ? nettoInferredCostMinor / payedSumMinor * 100 : null,
  };
}

/** Aggregate raw rows by Poster category ID, independently of product grouping. */
export function groupCategorySales(rows: readonly PosterSalesFact[]): CategorySales[] {
  const groups = new Map<number | null, PosterSalesFact[]>();
  for (const row of rows) {
    const group = groups.get(row.categoryId) ?? [];
    group.push(row);
    groups.set(row.categoryId, group);
  }
  return [...groups.entries()].map(([categoryId, group]) => ({
    categoryId, rows: group.length,
    distinctProducts: new Set(group.map((row) => row.productId)).size,
    ...salesMetrics(group),
  })).sort((a, b) => (a.categoryId ?? Number.MAX_SAFE_INTEGER) - (b.categoryId ?? Number.MAX_SAFE_INTEGER));
}

/** Sum every modifier row; never Map.set(product_id, row) and lose siblings. */
export function groupProductSales(rows: readonly PosterSalesFact[]): ProductSales[] {
  const groups = new Map<number, PosterSalesFact[]>();
  for (const row of rows) {
    const group = groups.get(row.productId) ?? [];
    group.push(row);
    groups.set(row.productId, group);
  }
  return [...groups.entries()].map(([productId, group]) => {
    const first = group[0];
    const categoryConflict = group.some((row) => row.categoryId !== first.categoryId);
    const unitConflict = group.some((row) => row.unit !== first.unit || row.weightBased !== first.weightBased);
    const quantity = unitConflict ? null : formatQuantity(group.reduce((sum, row) => sum + quantityScaled(row.quantity), 0n));
    return {
      productId, productName: first.productName, categoryId: categoryConflict ? null : first.categoryId,
      categoryConflict, unit: unitConflict ? null : first.unit, unitConflict,
      weightBased: unitConflict ? null : first.weightBased, quantity,
      modificationIds: [...new Set(group.map((row) => row.modificationId))].sort((a, b) => a - b),
      rows: group.length, ...salesMetrics(group),
    };
  }).sort((a, b) => a.productId - b.productId);
}

/** Includes products that exist in only one period; absent is null, not 0%. */
export function compareProductPeriods(current: readonly ProductSales[], previous: readonly ProductSales[]): ProductPeriodComparison[] {
  const currentById = new Map(current.map((row) => [row.productId, row]));
  const previousById = new Map(previous.map((row) => [row.productId, row]));
  const ids = [...new Set([...currentById.keys(), ...previousById.keys()])].sort((a, b) => a - b);
  return ids.map((productId) => {
    const present = currentById.get(productId) ?? null;
    const past = previousById.get(productId) ?? null;
    return {
      productId, current: present, previous: past,
      foodCostDeltaPoints: present?.foodCostPercent !== null && present?.foodCostPercent !== undefined &&
        past?.foodCostPercent !== null && past?.foodCostPercent !== undefined
        ? present.foodCostPercent - past.foodCostPercent : null,
      nettoFoodCostDeltaPoints: present?.nettoFoodCostPercent !== null && present?.nettoFoodCostPercent !== undefined &&
        past?.nettoFoodCostPercent !== null && past?.nettoFoodCostPercent !== undefined
        ? present.nettoFoodCostPercent - past.nettoFoodCostPercent : null,
    };
  });
}
