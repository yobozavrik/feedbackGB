import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

describe("foodcost nightly schedule", () => {
  it("keeps unrelated daily-report slots unchanged", () => {
    expect(config.crons.filter((job) => job.path === "/api/cron/daily-report"))
      .toEqual([
        { path: "/api/cron/daily-report", schedule: "30 18 * * *" },
        { path: "/api/cron/daily-report", schedule: "30 19 * * *" },
      ]);
  });

  it("schedules five bounded sales workers overnight in UTC", () => {
    expect(config.crons.filter((job) => job.path === "/api/cron/poster-foodcost-sales")
      .map((job) => job.schedule))
      .toEqual(["10 22 * * *", "10 23 * * *", "10 0 * * *", "10 1 * * *", "10 2 * * *"]);
  });

  it("retains two supply runs and moves them to nighttime UTC", () => {
    expect(config.crons.filter((job) => job.path === "/api/cron/poster-supply-cost")
      .map((job) => job.schedule)).toEqual(["40 23 * * *", "40 1 * * *"]);
  });

  it("contains no duplicate entries and keeps nightly jobs at fixed times", () => {
    expect(new Set(config.crons.map((job) => `${job.path}:${job.schedule}`)).size)
      .toBe(config.crons.length);
    expect(config.crons.filter((job) => job.path !== "/api/cron/utility-dispatch")
      .every((job) => /^\d+ \d+ \* \* \*$/.test(job.schedule))).toBe(true);
    expect(config.crons.filter((job) => job.path === "/api/cron/utility-dispatch"))
      .toEqual([{ path: "/api/cron/utility-dispatch", schedule: "*/5 * * * *" }]);
  });
});
