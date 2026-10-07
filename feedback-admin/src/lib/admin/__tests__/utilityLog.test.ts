import { afterEach, describe, expect, it, vi } from "vitest";
import { utilityTrace } from "@/lib/admin/utilityLog";

afterEach(() => vi.restoreAllMocks());

describe("admin utility request logging", () => {
  it("writes a safe error event and returns its request ID", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const trace = utilityTrace(new Request("http://local/test"), "GET /test");
    const response = trace.fail("query_failed", 500, "utility.admin.read_failed", "error",
      { submission_id: "test-id", signed_url: "https://private" } as never);
    const record = JSON.parse(String(error.mock.calls[0][0]));
    expect(response.headers.get("x-request-id")).toBe(trace.requestId);
    expect(await response.json()).toEqual({ error: "query_failed" });
    expect(record).toMatchObject({ request_id: trace.requestId, error_code: "query_failed", http_status: 500 });
    expect(record).not.toHaveProperty("signed_url");
  });
});
