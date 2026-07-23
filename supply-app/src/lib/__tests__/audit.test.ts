import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/audit";

function req(headers: Record<string, string>): Request {
  return new Request("https://supply.example.invalid", { headers });
}

describe("clientIp", () => {
  it("returns a clean IPv4 from the first XFF hop", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("strips a :port suffix from IPv4", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4:5678" }))).toBe("1.2.3.4");
  });

  it("accepts a bare IPv6 literal", () => {
    expect(clientIp(req({ "x-forwarded-for": "::1" }))).toBe("::1");
  });

  it("returns null for garbage", () => {
    expect(clientIp(req({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
  });

  it("returns null for out-of-range IPv4 octets", () => {
    expect(clientIp(req({ "x-forwarded-for": "999.1.1.1" }))).toBeNull();
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("returns null when no IP headers are present", () => {
    expect(clientIp(req({}))).toBeNull();
  });
});
