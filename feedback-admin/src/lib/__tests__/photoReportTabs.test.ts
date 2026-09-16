import { describe, expect, it } from "vitest";
import { photoReportTabKey } from "../photoReportTabs";

describe("photoReportTabKey", () => {
  it("accepts only supported, shareable tab keys", () => {
    expect(photoReportTabKey("daily")).toBe("daily");
    expect(photoReportTabKey("stores")).toBe("stores");
    expect(photoReportTabKey("attendance")).toBe("attendance");
  });

  it("safely falls back to daily for absent or invalid URL values", () => {
    expect(photoReportTabKey(undefined)).toBe("daily");
    expect(photoReportTabKey("unknown")).toBe("daily");
  });
});
