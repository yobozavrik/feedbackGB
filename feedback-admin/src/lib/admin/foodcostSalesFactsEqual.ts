import type { FoodcostSalesFactInsert } from "./foodcostSalesSnapshot";

const FIELDS = [
  "product_id", "modification_id", "category_id_snapshot", "product_name_snapshot",
  "category_name_snapshot", "quantity", "unit", "weight_based", "payed_sum_minor",
  "product_profit_minor", "product_profit_netto_minor", "product_sum_minor",
  "bonus_sum_minor", "cert_sum_minor", "discount_minor",
] as const;

function integer(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid_snapshot_integer");
  if (String(value).trim() === "") throw new Error("invalid_snapshot_integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("invalid_snapshot_integer");
  return parsed;
}

function decimal7(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid_snapshot_quantity");
  const match = /^(-?)(\d+)(?:\.(\d{1,7}))?$/.exec(String(value));
  if (!match) throw new Error("invalid_snapshot_quantity");
  const whole = BigInt(match[2]).toString();
  const fraction = (match[3] ?? "").padEnd(7, "0");
  const negative = match[1] === "-" && (whole !== "0" || fraction !== "0000000");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function signature(row: Record<string, unknown>): string {
  return JSON.stringify(FIELDS.map((field) => {
    const value = row[field];
    if (value === null) return null;
    if (field === "quantity") return decimal7(value);
    if (field.endsWith("_minor") || field.endsWith("_id") || field === "category_id_snapshot") {
      return integer(value);
    }
    if (field === "weight_based") {
      if (typeof value !== "boolean") throw new Error("invalid_snapshot_boolean");
      return value;
    }
    if (typeof value !== "string") throw new Error("invalid_snapshot_text");
    return value;
  }));
}

/** Exact multiset comparison; source row ordering is not part of the Poster grain. */
export function sameFoodcostSalesFacts(
  source: readonly FoodcostSalesFactInsert[], stored: readonly Record<string, unknown>[],
): boolean {
  if (source.length !== stored.length) return false;
  try {
    const counts = new Map<string, number>();
    for (const row of stored) {
      const key = signature(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of source) {
      const key = signature(row);
      const count = counts.get(key) ?? 0;
      if (!count) return false;
      counts.set(key, count - 1);
    }
    return [...counts.values()].every((count) => count === 0);
  } catch {
    return false;
  }
}
