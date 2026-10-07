import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), canUseStore: vi.fn() }));
vi.mock("@/lib/utilityAccess", () => ({
  utilityContext: mocks.context,
  canUseUtilityStore: mocks.canUseStore,
}));
import { GET } from "@/app/api/utility-readings/route";

const currentId = "fdb7a778-7437-4ee3-83ce-0d9967f4a944";
const oldId = "3774c78d-0b6e-47d7-8643-a4488573ab14";
const current = { id: currentId, period_start: "2026-10-01", period_end: "2026-10-31",
  due_at: "2026-10-31T21:59:59.999Z", status: "open" };
const old = { id: oldId, period_start: "2026-09-01", period_end: "2026-09-30",
  due_at: "2026-09-30T20:59:59.999Z", status: "closed" };
const oldSubmission = { id: "a9e69eb6-5019-48a5-bfc5-65ba49061d95",
  period_id: oldId, category: "water", review_status: "verified", review_note: null,
  revision: 2, submitted_at: "2026-09-30T12:00:00Z" };

function dbMock() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: currentId, error: null }),
    from: vi.fn((table: string) => {
      if (table === "utility_periods") {
        const query = {
          select: () => query, eq: () => query,
          single: async () => ({ data: current, error: null }),
          in: async () => ({ data: [old], error: null }),
        };
        return query;
      }
      if (table === "utility_submissions") {
        let history = false;
        const query = {
          select: () => query, eq: () => query,
          neq: () => { history = true; return query; },
          is: () => history ? query : Promise.resolve({ data: [], error: null }),
          order: () => query,
          range: async () => ({ data: [oldSubmission], error: null, count: 1 }),
        };
        return query;
      }
      throw new Error("unexpected table");
    }),
  };
}

describe("utility readings history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ db: dbMock(), actor: { id: "seller", role: "seller", homeStoreId: 10 } });
    mocks.canUseStore.mockResolvedValue(true);
  });

  it("returns the prior month and its current submission for resubmission", async () => {
    const response = await GET(new Request("http://local/api/utility-readings?store_id=10"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      period: current, history: [{ id: oldSubmission.id, period: old }],
      history_has_more: false,
    });
  });

  it("rejects invalid history offsets", async () => {
    const response = await GET(new Request("http://local/api/utility-readings?store_id=10&history_offset=-1"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_history_offset" });
  });
});
