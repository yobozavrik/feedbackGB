import { afterEach, describe, expect, it, vi } from "vitest";
import { utilityTrace } from "@/lib/utilityLog";

afterEach(() => vi.restoreAllMocks());

describe("utility request logging", () => {
  it("returns a request ID and excludes non-allowlisted fields from logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const id = "7e5e72d2-8a62-440e-a744-ff54a03c7c11";
    const trace = utilityTrace(new Request("http://local/test", { headers: { "x-request-id": id } }), "GET /test");
    trace.log("utility.test", "info", { store_id: 10, token: "secret", signed_url: "https://private" } as never);
    const response = trace.json({ ok: true });
    const record = JSON.parse(String(info.mock.calls[0][0]));
    expect(response.headers.get("x-request-id")).toBe(id);
    expect(record).toMatchObject({ event: "utility.test", request_id: id, store_id: 10 });
    expect(record).not.toHaveProperty("token");
    expect(record).not.toHaveProperty("signed_url");
  });

  it("replaces an invalid incoming request ID", () => {
    const trace = utilityTrace(new Request("http://local/test", {
      headers: { "x-request-id": "secret-value" },
    }), "GET /test");
    expect(trace.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(trace.requestId).not.toBe("secret-value");
  });
});
