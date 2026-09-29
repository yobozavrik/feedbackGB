import type { FoodcostPeriodDays } from "./foodcostPeriod";
import { getServerSupabase } from "@/lib/supabase";
import { posterRequest } from "./posterApi";
import { aggregateSupplyPriceWindows, type PosterSupplyDocument, type SupplyPriceReadModel } from "./posterSupplyPrices";

type SupplyRun = { id: string; window_start: string; window_end: string; expected_supplies: number; completed_at: string };
type SupplyDocumentRow = { supply_id: number; supply_date: string; lines: unknown };
type PosterIngredient = { ingredient_id?: string | number; ingredient_name?: string };

function unavailable(days: FoodcostPeriodDays, reason: string): SupplyPriceReadModel {
  const emptyPeriod = { from: "", to: "", status: "unavailable" as const, documentCount: 0 };
  return { status: "unavailable", reason, days, snapshot: null, current: emptyPeriod, previous: emptyPeriod,
    namedPurchasedIds: 0, purchasedIds: 0, rows: [] };
}

/** Read-only prices from one complete stored invoice snapshot; never starts a sync. */
export async function loadFoodcostSupplyPrices(days: FoodcostPeriodDays): Promise<SupplyPriceReadModel> {
  const db = getServerSupabase();
  if (!db) return unavailable(days, "supabase_unavailable");
  const latest = await db.from("poster_supply_cost_runs")
    .select("id,window_start,window_end,expected_supplies,completed_at")
    .eq("status", "completed").order("window_end", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) return unavailable(days, latest.error.code === "42P01" ? "schema_missing" : "snapshot_read_failed");
  if (!latest.data) return unavailable(days, "complete_snapshot_missing");
  const run = latest.data as SupplyRun;
  if (!Number.isSafeInteger(run.expected_supplies) || run.expected_supplies < 0 || !run.completed_at) return unavailable(days, "invalid_snapshot_metadata");
  const docs: SupplyDocumentRow[] = [];
  for (let offset = 0; offset < run.expected_supplies; offset += 500) {
    const page = await db.from("poster_supply_cost_documents").select("supply_id,supply_date,lines")
      .eq("run_id", run.id).order("supply_id").range(offset, Math.min(offset + 499, run.expected_supplies - 1));
    if (page.error) return unavailable(days, page.error.code === "42P01" ? "schema_missing" : "snapshot_documents_read_failed");
    docs.push(...(page.data ?? []) as SupplyDocumentRow[]);
  }
  if (docs.length !== run.expected_supplies || docs.some((doc) => !Array.isArray(doc.lines))) return unavailable(days, "snapshot_incomplete");
  const documents: PosterSupplyDocument[] = docs.map((doc) => ({ supplyId: Number(doc.supply_id), supplyDate: doc.supply_date,
    lines: (doc.lines as Array<Record<string, unknown>>).map((line) => ({
      ingredientId: Number(line.ingredientId), unit: line.unit as "kg" | "l" | "p",
      quantity: Number(line.quantity), sumMinor: Number(line.sumMinor),
    })) }));
  if (documents.some((doc) => !Number.isSafeInteger(doc.supplyId) || doc.supplyId <= 0 ||
    !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d$/.test(doc.supplyDate) ||
    doc.supplyDate.slice(0, 10) < run.window_start || doc.supplyDate.slice(0, 10) > run.window_end ||
    doc.lines.some((line) => !Number.isSafeInteger(line.ingredientId) || line.ingredientId <= 0 ||
      (line.unit !== "kg" && line.unit !== "l" && line.unit !== "p") || !Number.isFinite(line.quantity) || line.quantity <= 0 ||
      !Number.isSafeInteger(line.sumMinor) || line.sumMinor < 0))) return unavailable(days, "snapshot_contains_invalid_lines");
  let names = new Map<number, string>();
  if (process.env.POSTER_TOKEN) {
    try {
      const catalog = await posterRequest<PosterIngredient[]>("menu.getIngredients", {}, process.env.POSTER_TOKEN);
      if (Array.isArray(catalog)) {
        const counts = new Map<number, number>();
        for (const item of catalog) {
          const id = Number(item.ingredient_id);
          if (Number.isSafeInteger(id) && id > 0 && typeof item.ingredient_name === "string" && item.ingredient_name.trim()) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        }
        names = new Map(catalog.flatMap((item) => {
          const id = Number(item.ingredient_id);
          return Number.isSafeInteger(id) && id > 0 && counts.get(id) === 1 && typeof item.ingredient_name === "string" && item.ingredient_name.trim()
            ? [[id, item.ingredient_name.trim()] as [number, string]] : [];
        }));
      }
    } catch {
      // Prices remain usable with explicit ID fallback labels when current names are unavailable.
    }
  }
  const model = aggregateSupplyPriceWindows({ days, snapshotFrom: run.window_start, snapshotTo: run.window_end, documents, names });
  model.snapshot = { from: run.window_start, to: run.window_end, completedAt: run.completed_at,
    expectedDocuments: run.expected_supplies, fetchedDocuments: docs.length };
  return model;
}
