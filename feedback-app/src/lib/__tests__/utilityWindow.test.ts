import { describe, expect, it } from "vitest";
import { utilityInitialWindowState } from "../utilityWindow";

describe("first utility submission window", () => {
  const october = {
    status: "open",
    period_start: "2026-10-01",
    due_at: "2026-10-31T21:59:59.999Z",
  };

  it("opens exactly at Kyiv midnight on the 28th", () => {
    expect(utilityInitialWindowState(october, Date.parse("2026-10-27T21:59:59.999Z"))).toBe("upcoming");
    expect(utilityInitialWindowState(october, Date.parse("2026-10-27T22:00:00Z"))).toBe("open");
  });

  it("closes after the last millisecond of the month", () => {
    expect(utilityInitialWindowState(october, Date.parse(october.due_at))).toBe("open");
    expect(utilityInitialWindowState(october, Date.parse("2026-10-31T22:00:00Z"))).toBe("closed");
  });

  it("honours short February and an administratively closed period", () => {
    const february = { status: "open", period_start: "2028-02-01",
      due_at: "2028-02-29T21:59:59.999Z" };
    expect(utilityInitialWindowState(february, Date.parse("2028-02-29T10:00:00Z"))).toBe("open");
    expect(utilityInitialWindowState({ ...february, status: "closed" }, Date.parse("2028-02-29T10:00:00Z")))
      .toBe("closed");
  });
});
