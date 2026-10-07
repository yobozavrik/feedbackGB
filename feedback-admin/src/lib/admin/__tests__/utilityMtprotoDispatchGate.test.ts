import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cronAuth", () => ({ checkCronAuth: () => ({ ok: true }) }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: () => {
  throw new Error("Bot API worker must not touch Supabase in MTProto mode");
} }));

import { GET } from "@/app/api/cron/utility-dispatch/route";

afterEach(() => vi.unstubAllEnvs());

describe("utility MTProto transport gate", () => {
  it("never claims a job in the old Bot API route", async () => {
    vi.stubEnv("UTILITY_READINGS_ENABLED", "true");
    vi.stubEnv("UTILITY_DELIVERY_TRANSPORT", "mtproto");
    const response = await GET(new Request("http://local/api/cron/utility-dispatch"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true, reason: "external_mtproto_worker" });
  });
});
