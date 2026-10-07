import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), canUseStore: vi.fn(), prior: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/utilityAccess", () => ({
  utilityContext: mocks.context,
  canUseUtilityStore: mocks.canUseStore,
  validUuid: (value: unknown) => typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
}));
import { POST } from "@/app/api/utility-readings/uploads/route";

const periodId = "fdb7a778-7437-4ee3-83ce-0d9967f4a944";
const clientId = "597b24f2-d36b-4777-b9a4-e19d44de39f6";
let period = { id: periodId, period_start: "2026-09-01", status: "closed",
  due_at: "2026-09-30T20:59:59.999Z" };

function request() {
  const form = new FormData();
  form.set("store_id", "10");
  form.set("period_id", periodId);
  form.set("category", "water");
  form.set("client_submission_id", clientId);
  form.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    "meter.jpg", { type: "image/jpeg" }));
  return new Request("http://local/api/utility-readings/uploads", { method: "POST", body: form });
}

function dbMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "utility_periods") {
        const query = { select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: period, error: null }) };
        return query;
      }
      if (table === "utility_submissions") {
        const query = { select: () => query, eq: () => query, is: () => query,
          maybeSingle: mocks.prior };
        return query;
      }
      if (table === "utility_uploads") {
        const query = { select: () => query, eq: () => query, is: () => query,
          gte: async () => ({ count: 0, error: null }),
          insert: async () => ({ error: null }) };
        return query;
      }
      throw new Error("unexpected table");
    }),
    storage: { from: () => ({ upload: mocks.upload }) },
  };
}

describe("utility upload for a prior month", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    period = { id: periodId, period_start: "2026-09-01", status: "closed",
      due_at: "2026-09-30T20:59:59.999Z" };
    mocks.context.mockResolvedValue({ db: dbMock(), actor: {
      id: "767185a7-1b5c-4210-bdc0-342b074cc85c", role: "seller", homeStoreId: 10,
    } });
    mocks.canUseStore.mockResolvedValue(true);
    mocks.upload.mockResolvedValue({ error: null });
  });

  it("rejects the first upload for an old month", async () => {
    mocks.prior.mockResolvedValue({ data: null, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("accepts a new photo when that category already has a submission", async () => {
    mocks.prior.mockResolvedValue({ data: { id: "a9e69eb6-5019-48a5-bfc5-65ba49061d95" }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mime: "image/jpeg" });
    expect(mocks.upload).toHaveBeenCalledOnce();
  });

  it("rejects a first photo before the 28th Kyiv date", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
      period = { id: periodId, period_start: "2026-10-01", status: "open",
        due_at: "2026-10-31T21:59:59.999Z" };
      mocks.prior.mockResolvedValue({ data: null, error: null });
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "window_not_open" });
      expect(mocks.upload).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("permits a replacement photo before the 28th when a submission exists", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
      period = { id: periodId, period_start: "2026-10-01", status: "open",
        due_at: "2026-10-31T21:59:59.999Z" };
      mocks.prior.mockResolvedValue({ data: { id: "a9e69eb6-5019-48a5-bfc5-65ba49061d95" }, error: null });
      expect((await POST(request())).status).toBe(200);
      expect(mocks.upload).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
