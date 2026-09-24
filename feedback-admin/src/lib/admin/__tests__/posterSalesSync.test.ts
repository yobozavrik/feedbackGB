import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  posterRequest: vi.fn(),
  getServerSupabase: vi.fn(),
}));
vi.mock("../posterApi", () => ({ posterRequest: mocked.posterRequest }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));

import { syncPosterSalesSpotDay } from "../posterSalesSync";
import { buildFoodcostSalesSnapshot } from "../foodcostSalesSnapshot";

function posterRow() {
  return {
    product_id: "121", modification_id: "0", category_id: "7",
    product_name: "Пельмені зі свинини", weight_flag: "1", unit: "kg", count: "1.0000000",
    payed_sum: "19000", product_profit: "11000", product_profit_netto: "11500",
    product_sum: "19000", bonus_sum: "0", cert_sum: "0", discount: "0",
  };
}

describe("single-spot Poster sales sync", () => {
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousPoster = process.env.POSTER_TOKEN;

  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    process.env.POSTER_TOKEN = "test-poster-token";
    mocked.posterRequest.mockReset();
    mocked.getServerSupabase.mockReset();
  });
  afterEach(() => {
    if (previousService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
    if (previousPoster === undefined) delete process.env.POSTER_TOKEN;
    else process.env.POSTER_TOKEN = previousPoster;
  });

  it("rejects invalid scope before contacting Poster or Supabase", async () => {
    await expect(syncPosterSalesSpotDay("2026-02-30", 1)).rejects.toThrow("invalid_sales_sync_scope");
    await expect(syncPosterSalesSpotDay("2026-09-23", 0)).rejects.toThrow("invalid_sales_sync_scope");
    expect(mocked.posterRequest).not.toHaveBeenCalled();
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
  });

  it("does not create a run when any source row is malformed", async () => {
    mocked.posterRequest.mockResolvedValueOnce([{ spot_id: "1" }])
      .mockResolvedValueOnce([posterRow(), { ...posterRow(), count: "NaN" }]);
    const from = vi.fn();
    mocked.getServerSupabase.mockReturnValue({ from });
    await expect(syncPosterSalesSpotDay("2026-09-23", 1)).rejects.toThrow("invalid_count");
    expect(mocked.getServerSupabase).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("marks a run completed only after fact count and sums are read back", async () => {
    mocked.posterRequest.mockResolvedValueOnce([{ spot_id: "1" }]).mockResolvedValueOnce([posterRow()]);
    const stages: string[] = [];
    const db = {
      from(table: string) {
        if (table === "foodcost_sales_runs") return {
          select() {
            stages.push("latest_run");
            return { eq: () => ({ eq: () => ({ eq: () => ({
              order: () => ({ order: () => ({ limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }) }) }),
            }) }) }) };
          },
          insert() {
            stages.push("run_insert");
            return { select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }) };
          },
          update(value: { status: string }) {
            stages.push(`run_${value.status}`);
            return { eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }) }) }) };
          },
        };
        if (table === "foodcost_sales_facts") return {
          insert(rows: unknown[]) {
            stages.push(`facts_insert_${rows.length}`);
            return Promise.resolve({ error: null });
          },
          select(_columns: string, options?: { head?: boolean }) {
            if (options?.head) {
              stages.push("facts_count");
              return { eq: async () => ({ count: 1, error: null }) };
            }
            stages.push("facts_readback");
            return { eq: () => ({ order: () => ({ range: async () => ({
              data: [{ source_row_no: 0, payed_sum_minor: 19000,
                product_profit_minor: 11000, product_profit_netto_minor: 11500 }], error: null,
            }) }) }) };
          },
        };
        throw new Error(`unexpected_table_${table}`);
      },
    };
    mocked.getServerSupabase.mockReturnValue(db);
    const result = await syncPosterSalesSpotDay("2026-09-23", 1);
    expect(result).toMatchObject({ runId: "run-1", sourceRowCount: 1, payedSumMinor: 19000 });
    expect(stages).toEqual(["latest_run", "run_insert", "facts_insert_1", "facts_count", "facts_readback", "run_completed"]);
    expect(mocked.posterRequest).toHaveBeenCalledWith("access.getSpots", {}, "test-poster-token");
    expect(mocked.posterRequest).toHaveBeenCalledWith("dash.getProductsSales",
      { date_from: "20260923", date_to: "20260923", spot_id: "1" }, "test-poster-token");
  });

  it("does not persist a zero-row run for an unknown Poster spot", async () => {
    mocked.posterRequest.mockResolvedValueOnce([{ spot_id: "2" }]);
    const from = vi.fn();
    mocked.getServerSupabase.mockReturnValue({ from });
    await expect(syncPosterSalesSpotDay("2026-09-23", 1)).rejects.toThrow("unknown_poster_spot");
    expect(from).not.toHaveBeenCalled();
    expect(mocked.posterRequest).toHaveBeenCalledOnce();
  });

  it("reuses the completed run when every Poster fact is unchanged", async () => {
    mocked.posterRequest.mockResolvedValueOnce([{ spot_id: "1" }]).mockResolvedValueOnce([posterRow()]);
    const snapshot = buildFoodcostSalesSnapshot([posterRow()]);
    const insert = vi.fn();
    const db = {
      from(table: string) {
        if (table === "foodcost_sales_runs") return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
            order: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({
              data: { id: "existing-run", source_row_count: snapshot.sourceRowCount,
                payed_sum_minor: snapshot.payedSumMinor, product_profit_minor: snapshot.productProfitMinor,
                product_profit_netto_minor: snapshot.productProfitNettoMinor,
                source_fetched_at: "2026-09-24T00:00:00Z" }, error: null,
            }) }) }) }),
          }) }) }) }),
          insert,
        };
        if (table === "foodcost_sales_facts") return {
          select: () => ({ eq: () => ({ order: () => ({ range: async () => ({
            data: snapshot.facts, error: null,
          }) }) }) }),
        };
        throw new Error(`unexpected_table_${table}`);
      },
    };
    mocked.getServerSupabase.mockReturnValue(db);
    const result = await syncPosterSalesSpotDay("2026-09-23", 1);
    expect(result).toMatchObject({ runId: "existing-run", unchanged: true,
      sourceFetchedAt: "2026-09-24T00:00:00Z" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a current or future Kyiv day before any external call", async () => {
    await expect(syncPosterSalesSpotDay("9999-12-31", 1)).rejects.toThrow("sales_day_not_closed");
    expect(mocked.posterRequest).not.toHaveBeenCalled();
  });
});
