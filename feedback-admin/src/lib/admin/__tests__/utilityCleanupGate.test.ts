import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cronAuth", () => ({ checkCronAuth: () => ({ ok: true }) }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: () => null }));

import { GET } from "@/app/api/cron/utility-cleanup/route";

afterEach(() => vi.unstubAllEnvs());

describe("utility cleanup gate", () => {
  it("runs independently of Telegram dispatch when the admin feature is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", "true");
    vi.stubEnv("UTILITY_READINGS_ENABLED", "false");
    const response = await GET(new Request("http://local/api/cron/utility-cleanup"));
    expect(response.status).toBe(503); // Passed the gate; no DB client is configured in this test.
    expect((await response.json()).error).toBe("backend_unavailable");
  });

  it("skips while the admin feature is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", "false");
    vi.stubEnv("UTILITY_READINGS_ENABLED", "true");
    const response = await GET(new Request("http://local/api/cron/utility-cleanup"));
    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toBe(true);
  });
});
