import { getServerSupabase } from "@/lib/supabase";
import type { FoodCostIngredient, FoodCostSample } from "./posterFoodCost";
import { costFromSupplyAverage, kyivSupplyWindow, type SupplyAverage } from "./posterSupplyCostMath";

export type SupplyCostRow = {
  costMinor: number | null;
  supplyCount: number | null;
  note: string | null;
};

export type SupplyComparison = {
  status: "ready" | "no_snapshot" | "stale" | "schema_missing" | "unavailable";
  windowFrom: string | null;
  windowTo: string | null;
  completedAt: string | null;
  supplyDocuments: number | null;
  rows: Record<string, SupplyCostRow>;
  totalMinor: number | null;
  missingRows: number;
};

function empty(status: SupplyComparison["status"], sample: FoodCostSample): SupplyComparison {
  return { status, windowFrom: null, windowTo: null, completedAt: null, supplyDocuments: null,
    rows: Object.fromEntries(sample.ingredients.map((row) => [row.key, { costMinor: null, supplyCount: null, note: null }])),
    totalMinor: null, missingRows: sample.ingredients.length };
}

function costOfIngredient(row: FoodCostIngredient, averages: Map<number, SupplyAverage[]>): SupplyCostRow {
  if (row.ingredientId === null) return { costMinor: null, supplyCount: null, note: "Немає ID інгредієнта" };
  const candidates = (averages.get(row.ingredientId) ?? []).map((average) => ({
    average, amount: costFromSupplyAverage({ brutto: row.brutto, unit: row.unit }, average),
  })).filter((item) => item.amount !== null);
  if (candidates.length !== 1) return { costMinor: null, supplyCount: null,
    note: candidates.length > 1 ? "Кілька несумісних одиниць у постачаннях" : "Немає постачань або одиниці не збігаються" };
  return { costMinor: candidates[0].amount, supplyCount: candidates[0].average.supplyCount, note: null };
}

export function compareSupplyCosts(sample: FoodCostSample, averageRows: SupplyAverage[], meta: {
  windowFrom: string; windowTo: string; completedAt: string; supplyDocuments: number;
}): SupplyComparison {
  const averages = new Map<number, SupplyAverage[]>();
  for (const average of averageRows) averages.set(average.ingredientId, [...(averages.get(average.ingredientId) ?? []), average]);
  const rows: Record<string, SupplyCostRow> = {};
  for (const row of sample.ingredients) {
    if (row.kind === "ingredient") {
      rows[row.key] = costOfIngredient(row, averages);
      continue;
    }
    const prepack = sample.prepacks.find((item) => item.productId === row.ingredientId);
    if (!prepack || !prepack.outputWeight || prepack.outputWeight <= 0 || row.unit !== "g" || row.brutto === null ||
      prepack.posterCostMinor === null || row.costMinor === null ||
      Math.abs(row.costMinor - prepack.posterCostMinor * row.brutto / prepack.outputWeight) > 2) {
      rows[row.key] = { costMinor: null, supplyCount: null, note: "Немає перевіреного виходу напівфабрикату" };
      continue;
    }
    const parts = prepack.ingredients.map((part) => part.kind === "ingredient"
      ? costOfIngredient(part, averages)
      : { costMinor: null, supplyCount: null, note: "Вкладений напівфабрикат не підтримується" });
    if (parts.some((part) => part.costMinor === null)) {
      rows[row.key] = { costMinor: null, supplyCount: null, note: "Не всі компоненти напівфабрикату мають ціну постачання" };
      continue;
    }
    rows[row.key] = {
      costMinor: parts.reduce((sum, part) => sum + (part.costMinor ?? 0), 0) * row.brutto / prepack.outputWeight,
      supplyCount: null,
      note: "Розраховано з компонентів напівфабрикату пропорційно його виходу",
    };
  }
  const values = Object.values(rows);
  const missingRows = values.filter((row) => row.costMinor === null).length;
  return { status: "ready", ...meta, rows,
    totalMinor: missingRows === 0 ? values.reduce((sum, row) => sum + (row.costMinor ?? 0), 0) : null,
    missingRows };
}

export async function loadSupplyComparison(sample: FoodCostSample): Promise<SupplyComparison> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return empty("unavailable", sample);
  const db = getServerSupabase();
  if (!db) return empty("unavailable", sample);
  const latest = await db.from("poster_supply_cost_runs")
    .select("id,window_start,window_end,completed_at,expected_supplies")
    .eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error?.code === "42P01") return empty("schema_missing", sample);
  if (latest.error) return empty("unavailable", sample);
  if (!latest.data) return empty("no_snapshot", sample);
  const today = kyivSupplyWindow(new Date()).to;
  if (latest.data.window_end !== today) return {
    ...empty("stale", sample), windowFrom: latest.data.window_start,
    windowTo: latest.data.window_end, completedAt: latest.data.completed_at,
    supplyDocuments: latest.data.expected_supplies,
  };
  const ids = [...new Set([
    ...sample.ingredients.filter((row) => row.kind === "ingredient").map((row) => row.ingredientId),
    ...sample.prepacks.flatMap((prepack) => prepack.ingredients.filter((row) => row.kind === "ingredient").map((row) => row.ingredientId)),
  ].filter((id): id is number => id !== null))];
  if (ids.length === 0) return empty("unavailable", sample);
  const fetched = await db.from("poster_supply_cost_averages")
    .select("ingredient_id,ingredient_unit,total_quantity,total_sum_minor,supply_count")
    .eq("run_id", latest.data.id).in("ingredient_id", ids);
  if (fetched.error) return empty("unavailable", sample);
  const averages: SupplyAverage[] = (fetched.data ?? []).map((row: any) => ({
    ingredientId: Number(row.ingredient_id), unit: row.ingredient_unit,
    totalQuantity: Number(row.total_quantity), totalSumMinor: Number(row.total_sum_minor),
    supplyCount: Number(row.supply_count),
  }));
  return compareSupplyCosts(sample, averages, {
    windowFrom: latest.data.window_start, windowTo: latest.data.window_end,
    completedAt: latest.data.completed_at, supplyDocuments: latest.data.expected_supplies,
  });
}

export function unavailableSupplyComparison(sample: FoodCostSample): SupplyComparison {
  return empty("unavailable", sample);
}
