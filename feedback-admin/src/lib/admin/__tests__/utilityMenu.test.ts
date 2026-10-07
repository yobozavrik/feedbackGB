import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAdminRoute } from "../menu";

afterEach(() => vi.unstubAllEnvs());

describe("utility readings admin menu", () => {
  it("shows the item when the feature flag is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", undefined);
    const route = buildAdminRoute(true);
    expect(JSON.stringify(route)).toContain("/admin/utility-readings");
  });
});
