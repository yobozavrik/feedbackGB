import { afterEach, describe, expect, it, vi } from "vitest";
import { utilityReadingsEnabled } from "../utilityFeature";

afterEach(() => vi.unstubAllEnvs());

describe("utility photo report availability", () => {
  it("is enabled when no flag is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", undefined);
    expect(utilityReadingsEnabled()).toBe(true);
  });

  it("can be disabled explicitly", () => {
    vi.stubEnv("NEXT_PUBLIC_UTILITY_READINGS_ENABLED", "false");
    expect(utilityReadingsEnabled()).toBe(false);
  });
});
