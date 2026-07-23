import { describe, expect, it } from "vitest";
import { classifyConsumablesCrmFailure } from "../consumablesOrderError";

describe("classifyConsumablesCrmFailure", () => {
  it("maps an unmapped-store refusal to 409 and asks to log the store id", () => {
    const r = classifyConsumablesCrmFailure(null, {
      error: "FeedbackGB store is not mapped to a CRM shop",
    });
    expect(r.status).toBe(409);
    expect(r.logStoreId).toBe(true);
    expect(r.error).toMatch(/магазин/i);
  });

  it("maps an invalid-cart-item exception to 409 (refresh catalog)", () => {
    const r = classifyConsumablesCrmFailure({ message: "Invalid FeedbackGB cart item" }, null);
    expect(r.status).toBe(409);
    expect(r.logStoreId).toBe(false);
    expect(r.error).toMatch(/оновіть каталог/i);
  });

  it("falls back to a generic 502 for unknown / transient failures", () => {
    expect(classifyConsumablesCrmFailure({ message: "deadlock detected" }, null).status).toBe(502);
    expect(classifyConsumablesCrmFailure(null, { error: "Cart is empty" }).status).toBe(502);
    expect(classifyConsumablesCrmFailure(null, null).status).toBe(502);
  });

  it("is case-insensitive on the CRM message", () => {
    expect(
      classifyConsumablesCrmFailure(null, { error: "STORE IS NOT MAPPED to a CRM shop" }).status,
    ).toBe(409);
    expect(
      classifyConsumablesCrmFailure({ message: "INVALID FEEDBACKGB CART ITEM" }, null).status,
    ).toBe(409);
  });

  it("prefers the exception message over the RETURNed error when both exist", () => {
    // A RAISE EXCEPTION and a handled error shouldn't co-occur, but if they do
    // the thrown one is the more specific signal.
    const r = classifyConsumablesCrmFailure(
      { message: "Invalid FeedbackGB cart item" },
      { error: "not mapped" },
    );
    expect(r.error).toMatch(/оновіть каталог/i);
  });
});
