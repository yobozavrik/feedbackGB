import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appSurfaceLabel,
  formatTime,
  readAppSurface,
  readGeo,
} from "../auditFormat";

describe("formatTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows time only for same-day events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T15:00:00"));
    expect(formatTime("2026-07-02T09:05:07")).toBe("09:05:07");
  });

  it("shows compact date+time for older events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T15:00:00"));
    const out = formatTime("2026-06-30T09:05:07");
    expect(out).toContain("30.06");
    expect(out).toContain("09:05");
  });
});

describe("readAppSurface / appSurfaceLabel", () => {
  it("extracts a string app_surface from meta", () => {
    expect(readAppSurface({ app_surface: "web_app" })).toBe("web_app");
    expect(readAppSurface({ app_surface: 5 })).toBeNull();
    expect(readAppSurface(null)).toBeNull();
  });

  it("maps known surfaces to labels and unknown to null", () => {
    expect(appSurfaceLabel("web_app")).toEqual({ label: "Веб-апп", color: "green" });
    expect(appSurfaceLabel("admin_panel")).toEqual({ label: "Адмінка", color: "magenta" });
    expect(appSurfaceLabel("cli")).toBeNull();
    expect(appSurfaceLabel(null)).toBeNull();
  });
});

describe("readGeo", () => {
  it("returns the geoip object when present", () => {
    expect(readGeo({ geoip: { country: "UA", city: "Чернівці" } })).toEqual({
      country: "UA",
      city: "Чернівці",
    });
    expect(readGeo({})).toBeNull();
    expect(readGeo(null)).toBeNull();
  });
});
