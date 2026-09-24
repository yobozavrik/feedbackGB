import { getServerSupabase } from "@/lib/supabase";
import { posterRequest } from "./posterApi";
import { aggregateSupplyLines, kyivSupplyWindow, parseSupplyLines, type SupplyLine } from "./posterSupplyCostMath";

type SupplyHeader = { supply_id?: string | number; storage_id?: string | number; date?: string; delete?: string | number };
type RunRow = { id: string; window_start: string; window_end: string; status: string; seeded_at: string | null; expected_supplies: number };
type DocumentRow = {
  run_id: string; supply_id: number; storage_id: number; supply_date: string;
  lines: SupplyLine[] | null; attempts: number;
};

const DETAIL_BATCH = 40;
const DETAIL_CONCURRENCY = 8;

function assertDb(error: { code?: string } | null, stage: string): void {
  if (error) throw new Error(error.code === "42P01" ? "schema_missing" : `supply_db_${stage}_${error.code ?? "unknown"}`);
}

function cleanHeader(row: SupplyHeader): { supply_id: number; storage_id: number; supply_date: string } {
  const supply_id = Number(row.supply_id);
  const storage_id = Number(row.storage_id);
  const supply_date = row.date;
  if (!Number.isSafeInteger(supply_id) || supply_id <= 0 ||
    !Number.isSafeInteger(storage_id) || storage_id <= 0 ||
    typeof supply_date !== "string" || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(supply_date)) {
    throw new Error("invalid_supply_header");
  }
  return { supply_id, storage_id, supply_date };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

/**
 * Completes one 30-day snapshot, resuming already-fetched documents after a
 * timed-out invocation. The UI only reads runs marked completed.
 */
export async function syncPosterSupplyCosts(now = new Date(), maxMillis = 210_000) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");

  const window = kyivSupplyWindow(now);
  const started = Date.now();
  const existing = await db.from("poster_supply_cost_runs").select("id,window_start,window_end,status,seeded_at,expected_supplies")
    .eq("window_start", window.from).eq("window_end", window.to).maybeSingle();
  assertDb(existing.error, "find_run");
  let run = existing.data as RunRow | null;
  if (!run) {
    const created = await db.from("poster_supply_cost_runs")
      .insert({ window_start: window.from, window_end: window.to }).select("id,window_start,window_end,status,seeded_at,expected_supplies").single();
    if (created.error?.code === "23505") {
      const raced = await db.from("poster_supply_cost_runs").select("id,window_start,window_end,status,seeded_at,expected_supplies")
        .eq("window_start", window.from).eq("window_end", window.to).single();
      assertDb(raced.error, "raced_run");
      run = raced.data as RunRow;
    } else {
      assertDb(created.error, "create_run");
      run = created.data as RunRow;
    }
  }
  if (run.status === "completed") return { status: "completed", window, expected: run.expected_supplies, remaining: 0 };

  if (!run.seeded_at) {
    const raw = await posterRequest<SupplyHeader[]>("storage.getSupplies", {
      dateFrom: window.from.replaceAll("-", ""), dateTo: window.to.replaceAll("-", ""),
    }, token);
    if (!Array.isArray(raw)) throw new Error("invalid_supply_list");
    const active = raw.filter((row) => String(row.delete) !== "1").map(cleanHeader);
    const ids = new Set(active.map((row) => row.supply_id));
    if (ids.size !== active.length) throw new Error("duplicate_supply_id");
    for (let offset = 0; offset < active.length; offset += 200) {
      const rows = active.slice(offset, offset + 200).map((row) => ({ run_id: run!.id, ...row }));
      const saved = await db.from("poster_supply_cost_documents").upsert(rows, {
        onConflict: "run_id,supply_id", ignoreDuplicates: true,
      });
      assertDb(saved.error, "seed_documents");
    }
    const seeded = await db.from("poster_supply_cost_runs").update({
      expected_supplies: active.length, seeded_at: new Date().toISOString(),
    }).eq("id", run.id);
    assertDb(seeded.error, "mark_seeded");
    run.expected_supplies = active.length;
  }

  while (Date.now() - started < maxMillis) {
    const pending = await db.from("poster_supply_cost_documents")
      .select("run_id,supply_id,storage_id,supply_date,lines,attempts")
      .eq("run_id", run.id).is("lines", null).lt("attempts", 3)
      .order("supply_id").limit(DETAIL_BATCH);
    assertDb(pending.error, "pending_documents");
    const rows = (pending.data ?? []) as DocumentRow[];
    if (rows.length === 0) break;
    const updates = await mapConcurrent(rows, DETAIL_CONCURRENCY, async (row) => {
      try {
        const raw = await posterRequest<unknown>("storage.getSupplyIngredients", { supply_id: String(row.supply_id) }, token);
        return { run_id: row.run_id, supply_id: row.supply_id, storage_id: row.storage_id,
          supply_date: row.supply_date, lines: parseSupplyLines(raw),
          attempts: row.attempts + 1, last_error: null, fetched_at: new Date().toISOString() };
      } catch {
        return { run_id: row.run_id, supply_id: row.supply_id, storage_id: row.storage_id,
          supply_date: row.supply_date, lines: null, attempts: row.attempts + 1,
          last_error: "detail_fetch_or_validation_failed", fetched_at: null };
      }
    });
    const saved = await db.from("poster_supply_cost_documents").upsert(updates, { onConflict: "run_id,supply_id" });
    assertDb(saved.error, "save_details");
  }

  const allCount = await db.from("poster_supply_cost_documents").select("supply_id", { count: "exact", head: true }).eq("run_id", run.id);
  assertDb(allCount.error, "count_documents");
  const pendingCount = await db.from("poster_supply_cost_documents").select("supply_id", { count: "exact", head: true })
    .eq("run_id", run.id).is("lines", null);
  assertDb(pendingCount.error, "count_pending");
  if (allCount.count !== run.expected_supplies) throw new Error("supply_document_count_mismatch");
  const remaining = pendingCount.count ?? 0;
  if (remaining > 0) return { status: "running", window, expected: run.expected_supplies, remaining };

  const documents: SupplyLine[][] = [];
  for (let offset = 0; offset < run.expected_supplies; offset += 500) {
    const page = await db.from("poster_supply_cost_documents").select("lines")
      .eq("run_id", run.id).order("supply_id").range(offset, offset + 499);
    assertDb(page.error, "read_documents");
    for (const document of page.data ?? []) {
      if (!Array.isArray(document.lines)) throw new Error("incomplete_supply_document");
      documents.push(document.lines as SupplyLine[]);
    }
  }
  if (documents.length !== run.expected_supplies) throw new Error("incomplete_supply_snapshot");
  const averages = aggregateSupplyLines(documents);
  for (let offset = 0; offset < averages.length; offset += 200) {
    const saved = await db.from("poster_supply_cost_averages").upsert(averages.slice(offset, offset + 200).map((row) => ({
      run_id: run!.id, ingredient_id: row.ingredientId, ingredient_unit: row.unit,
      total_quantity: row.totalQuantity, total_sum_minor: row.totalSumMinor, supply_count: row.supplyCount,
    })), { onConflict: "run_id,ingredient_id,ingredient_unit" });
    assertDb(saved.error, "save_averages");
  }
  const completed = await db.from("poster_supply_cost_runs").update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", run.id).eq("status", "running");
  assertDb(completed.error, "complete_run");
  return { status: "completed", window, expected: run.expected_supplies, remaining: 0, ingredients: averages.length };
}
