import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/admin/utilityAccess", () => ({ adminUtilityContext: mocks.context }));

import { GET } from "@/app/api/admin/utility-readings/coverage/route";

const periodId = "fdb7a778-7437-4ee3-83ce-0d9967f4a944";
const submissionId = "78f88008-1bba-4486-9fe7-3eb7eb086147";
const request = () => new Request(`http://local/api/admin/utility-readings/coverage?period_id=${periodId}`);

function dbMock() {
  const period = { id: periodId, period_start: "2026-10-01", period_end: "2026-10-31",
    due_at: "2026-10-31T21:59:59.999Z", status: "open" };
  const submission = { id: submissionId, store_id: 10, category: "water",
    review_status: "submitted", revision: 1, submitted_at: "2026-10-28T12:00:00Z" };
  const resultByTable: Record<string, { data: unknown[]; error: null; count: number }> = {
    v_stores: { data: [{ id: 10, name: "Тестовий магазин", is_active: true }], error: null, count: 1 },
    utility_submissions: { data: [submission], error: null, count: 1 },
    utility_photos: { data: [{ submission_id: submissionId }, { submission_id: submissionId }], error: null, count: 2 },
    utility_delivery_jobs: { data: [{ submission_id: submissionId, state: "pending", attempts: 0 }], error: null, count: 1 },
  };
  return { from: vi.fn((table: string) => {
    if (table === "utility_periods") {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: period, error: null }) };
      return query;
    }
    const query = { select: () => query, eq: () => query, is: () => query,
      order: () => query, in: () => query, limit: async () => resultByTable[table] };
    return query;
  }) };
}

describe("utility coverage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("denies access when the current user is not an active admin", async () => {
    mocks.context.mockResolvedValue({ error: "forbidden", status: 403 });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("allows coverage without a configured feature flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", undefined);
    mocks.context.mockResolvedValue({ db: dbMock(), actor: { id: "admin", role: "admin" } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json() as { rows: unknown[] }).rows).toHaveLength(4);
  });

  it("still allows an explicit emergency shutdown", async () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", "false");
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("returns four category rows and counts only photos of the matching submission", async () => {
    mocks.context.mockResolvedValue({ db: dbMock(), actor: { id: "admin", role: "admin" } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json() as { rows: Array<{ category: string; status: string; photo_count: number }> };
    expect(body.rows).toHaveLength(4);
    expect(body.rows.find((row) => row.category === "water"))
      .toMatchObject({ status: "submitted", photo_count: 2 });
    expect(body.rows.filter((row) => row.status === "missing")).toHaveLength(3);
  });
});
