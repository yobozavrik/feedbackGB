import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utilityAccess", () => ({
  utilityContext: vi.fn().mockResolvedValue({ db: {}, actor: { id: "test-user" } }),
  canUseUtilityStore: vi.fn(),
  validUuid: vi.fn(),
}));

import { POST } from "@/app/api/utility-readings/uploads/route";

describe("utility photo upload size guard", () => {
  it("parses a bounded multipart body", async () => {
    const form = new FormData();
    form.set("category", "water");
    const request = new Request("http://local/api/utility-readings/uploads", { method: "POST", body: form });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_upload" });
  });

  it("rejects an oversized multipart body without a Content-Length header", async () => {
    const form = new FormData();
    form.set("photo", new Blob([new Uint8Array(2 * 1024 * 1024 + 65 * 1024)]), "large.jpg");
    const request = new Request("http://local/api/utility-readings/uploads", { method: "POST", body: form });
    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "photo_too_large" });
  });
});
