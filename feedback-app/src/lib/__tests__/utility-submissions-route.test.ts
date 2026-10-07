import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canUseStore: vi.fn(), context: vi.fn(), rpc: vi.fn(), job: vi.fn() }));
vi.mock("@/lib/utilityAccess", () => ({
  canUseUtilityStore: mocks.canUseStore,
  utilityContext: mocks.context,
  validUuid: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
}));
import { POST } from "@/app/api/utility-readings/submissions/route";

const periodId = "fdb7a778-7437-4ee3-83ce-0d9967f4a944";
const clientId = "597b24f2-d36b-4777-b9a4-e19d44de39f6";
const uploadId = "65779937-f335-433f-b1c0-3d821deec7aa";
function request(uploadIds: unknown, category = "water", storeId = 10) {
  return new Request("http://local/api/utility-readings/submissions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ store_id: storeId, period_id: periodId, category,
      comment: null, client_submission_id: clientId, upload_ids: uploadIds }),
  });
}

describe("utility photo submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ db: {
      rpc: mocks.rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.job }) }) }),
    }, actor: { id: "767185a7-1b5c-4210-bdc0-342b074cc85c", role: "seller", homeStoreId: 10 } });
    mocks.canUseStore.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: "78f88008-1bba-4486-9fe7-3eb7eb086147", error: null });
    mocks.job.mockResolvedValue({ data: { state: "pending" }, error: null });
  });
  it("rejects a store without current permission", async () => {
    mocks.canUseStore.mockResolvedValue(false);
    expect((await POST(request([uploadId], "water", 99))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects no photos and unsupported categories", async () => {
    expect((await POST(request([]))).status).toBe(400);
    expect((await POST(request([uploadId], "gas"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends category and photo IDs to the atomic DB function", async () => {
    const response = await POST(request([uploadId]));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, telegram_status: "pending" });
    expect(mocks.rpc).toHaveBeenCalledWith("submit_utility_photos", expect.objectContaining({
      p_store_id: 10, p_period_id: periodId, p_category: "water", p_upload_ids: [uploadId],
    }));
  });
});
