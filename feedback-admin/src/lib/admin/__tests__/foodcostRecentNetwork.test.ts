import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getServerSupabase: vi.fn(), posterRequest: vi.fn(), loadFoodcostOverview: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));
vi.mock("../posterApi", () => ({ posterRequest: mocked.posterRequest }));
vi.mock("../foodcostOverview", () => ({ loadFoodcostOverview: mocked.loadFoodcostOverview }));

import { loadFoodcostRecentNetwork } from "../foodcostRecentNetwork";

const previousPoster = process.env.POSTER_TOKEN;
const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.POSTER_TOKEN = "test-token";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  vi.clearAllMocks();
  mocked.posterRequest.mockResolvedValue([{ spot_id: "2" }, { spot_id: "1" }]);
  mocked.getServerSupabase.mockReturnValue({ from: () => ({
    select: () => ({ order: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }) }),
  }) });
  mocked.loadFoodcostOverview.mockResolvedValue({ status: "complete", expectedCells: 6,
    completedCells: 6, missing: [], metrics: { payedSumMinor: 100 }, days: [] });
});
afterEach(() => {
  if (previousPoster === undefined) delete process.env.POSTER_TOKEN;
  else process.env.POSTER_TOKEN = previousPoster;
  if (previousService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
});

describe("current-roster recent network overview", () => {
  it("checks both rosters and returns a strictly labelled three-day scope", async () => {
    const result = await loadFoodcostRecentNetwork(new Date("2026-09-24T12:00:00Z"));
    expect(mocked.posterRequest).toHaveBeenCalledWith("access.getSpots", {}, "test-token");
    expect(mocked.loadFoodcostOverview).toHaveBeenCalledWith("2026-09-21", "2026-09-23", [1, 2]);
    expect(result).toMatchObject({ scope: "current_poster_roster_three_closed_days",
      historicalRosterVerified: false, spotCount: 2, expectedCells: 6, status: "complete" });
  });

  it("fails closed when Poster and v_stores disagree", async () => {
    mocked.posterRequest.mockResolvedValueOnce([{ spot_id: "1" }, { spot_id: "3" }]);
    await expect(loadFoodcostRecentNetwork(new Date("2026-09-24T12:00:00Z")))
      .rejects.toThrow("foodcost_roster_mismatch");
    expect(mocked.loadFoodcostOverview).not.toHaveBeenCalled();
  });

  it("does not query either source without both credentials", async () => {
    delete process.env.POSTER_TOKEN;
    await expect(loadFoodcostRecentNetwork()).rejects.toThrow("poster_token_missing");
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
    expect(mocked.posterRequest).not.toHaveBeenCalled();
  });
});
