import { describe, expect, it } from "vitest";
import { describeCronUtc } from "../cronSchedule";

describe("describeCronUtc", () => {
  it("describes a daily UTC cron as a Kyiv winter–summer range", () => {
    expect(describeCronUtc("30 18 * * *")).toBe(
      "щодня 20:30–21:30 (Київ, зима–літо) · 18:30 UTC",
    );
  });

  it("wraps around midnight", () => {
    expect(describeCronUtc("0 23 * * *")).toBe(
      "щодня 01:00–02:00 (Київ, зима–літо) · 23:00 UTC",
    );
  });

  it("returns non-daily expressions untouched", () => {
    expect(describeCronUtc("0 9 * * 1")).toBe("0 9 * * 1");
    expect(describeCronUtc("0 9 1 * *")).toBe("0 9 1 * *");
  });

  it("returns malformed expressions untouched", () => {
    expect(describeCronUtc("not a cron")).toBe("not a cron");
    expect(describeCronUtc("x y * * *")).toBe("x y * * *");
  });
});
