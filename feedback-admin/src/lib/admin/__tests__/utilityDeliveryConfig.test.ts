import { afterEach, describe, expect, it, vi } from "vitest";
import { utilityDeliveryConfigured } from "@/lib/admin/utilityDeliveryConfig";

afterEach(() => vi.unstubAllEnvs());

describe("utility delivery configuration", () => {
  it("keeps delivery hidden until the transport is enabled", () => {
    vi.stubEnv("UTILITY_READINGS_ENABLED", "false");
    vi.stubEnv("UTILITY_DELIVERY_TRANSPORT", "mtproto");
    expect(utilityDeliveryConfigured()).toBe(false);
  });

  it("recognizes the external work-account transport", () => {
    vi.stubEnv("UTILITY_READINGS_ENABLED", "true");
    vi.stubEnv("UTILITY_DELIVERY_TRANSPORT", "mtproto");
    expect(utilityDeliveryConfigured()).toBe(true);
  });

  it("fails closed for unknown transport", () => {
    vi.stubEnv("UTILITY_READINGS_ENABLED", "true");
    vi.stubEnv("UTILITY_DELIVERY_TRANSPORT", "unknown");
    expect(utilityDeliveryConfigured()).toBe(false);
  });
});
