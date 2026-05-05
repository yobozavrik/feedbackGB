import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetGeoipCacheForTests,
  countryFlag,
  geoipToAuditMeta,
  geoipToUserUpdate,
  isPrivateOrLocal,
  lookupIp,
  type GeoIpInfo,
} from "../geoip";

const EMPTY: GeoIpInfo = { country: null, city: null, asn: null, isp: null };

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const errResponse = (status: number) =>
  new Response("nope", { status, headers: { "content-type": "text/plain" } });

describe("isPrivateOrLocal", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1", // CGNAT
    "100.127.255.255", // CGNAT high
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "FE80::1",
    "fc00::1",
    "fd00::abcd:ef01",
    "::ffff:127.0.0.1", // IPv4-mapped IPv6 of loopback
    "::ffff:10.0.0.1", // IPv4-mapped IPv6 of RFC1918
    "fe80::1%eth0", // with zone id
    "unknown",
    "",
  ])("treats %s as private/local", (ip) => {
    expect(isPrivateOrLocal(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "94.158.55.10",
    "::ffff:8.8.8.8", // IPv4-mapped IPv6 of public IP
    "2001:db8::1", // documentation but reads as public for our gate
    "172.32.0.1", // not in 16-31 range
    "192.169.0.1", // off-by-one from 192.168
    "100.63.0.1", // off-by-one from CGNAT
  ])("treats %s as public", (ip) => {
    expect(isPrivateOrLocal(ip)).toBe(false);
  });
});

describe("geoipToAuditMeta", () => {
  it("returns null for the all-null EMPTY case", () => {
    expect(geoipToAuditMeta(EMPTY)).toBeNull();
  });

  it("returns a structured object when at least one field is set", () => {
    expect(
      geoipToAuditMeta({
        country: "UA",
        city: null,
        asn: null,
        isp: null,
      }),
    ).toEqual({ country: "UA", city: null, asn: null, isp: null });
  });
});

describe("geoipToUserUpdate", () => {
  it("returns null for the all-null EMPTY case", () => {
    expect(geoipToUserUpdate(EMPTY)).toBeNull();
  });

  it("includes only non-null fields (per-field overwrite protection)", () => {
    expect(
      geoipToUserUpdate({
        country: "UA",
        city: null,
        asn: "AS15895",
        isp: null,
      }),
    ).toEqual({
      last_login_country: "UA",
      last_login_asn: "AS15895",
    });
  });

  it("does not emit a payload of all undefined keys", () => {
    const payload = geoipToUserUpdate({
      country: "UA",
      city: "Kyiv",
      asn: "AS15895",
      isp: "Vodafone",
    });
    expect(payload).toEqual({
      last_login_country: "UA",
      last_login_city: "Kyiv",
      last_login_asn: "AS15895",
      last_login_isp: "Vodafone",
    });
  });
});

describe("countryFlag", () => {
  it("converts ISO-2 codes to regional indicator emoji", () => {
    expect(countryFlag("UA")).toBe("🇺🇦");
    expect(countryFlag("us")).toBe("🇺🇸");
  });

  it.each<string | null | undefined>([
    "",
    null,
    undefined,
    "U",
    "UKR",
    "U!",
    "Ukraine",
    "12",
  ])("returns '' for invalid input %p", (input) => {
    expect(countryFlag(input)).toBe("");
  });
});

describe("lookupIp", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    __resetGeoipCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.IPINFO_TOKEN = "test_token_xxx";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.IPINFO_TOKEN;
  });

  it("returns EMPTY for private IPs without making an HTTP call", async () => {
    const info = await lookupIp("127.0.0.1");
    expect(info).toEqual(EMPTY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns EMPTY for the literal 'unknown' IP", async () => {
    const info = await lookupIp("unknown");
    expect(info).toEqual(EMPTY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns EMPTY when IPINFO_TOKEN is unset", async () => {
    delete process.env.IPINFO_TOKEN;
    const info = await lookupIp("8.8.8.8");
    expect(info).toEqual(EMPTY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a normal ipinfo response", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        city: "Kyiv",
        country: "UA",
        org: "AS15895 Vodafone Ukraine",
      }),
    );
    const info = await lookupIp("94.158.55.10");
    expect(info).toEqual({
      country: "UA",
      city: "Kyiv",
      asn: "AS15895",
      isp: "Vodafone Ukraine",
    });
  });

  it("sends the token via Authorization header, not query string", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ country: "UA" }));
    await lookupIp("8.8.8.8");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("token=");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer test_token_xxx");
  });

  it("dedupes concurrent in-flight calls for the same IP (1 fetch, not 2)", async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                okResponse({ country: "UA", city: "Kyiv", org: "AS1 Foo" }),
              ),
            10,
          ),
        ),
    );
    const [a, b] = await Promise.all([
      lookupIp("8.8.8.8"),
      lookupIp("8.8.8.8"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("returns EMPTY (and does not throw) on non-2xx ipinfo responses", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(429));
    const info = await lookupIp("8.8.8.8");
    expect(info).toEqual(EMPTY);
  });

  it("survives an `org` field that is not a string", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ country: "UA", city: "Kyiv", org: 12345 }),
    );
    const info = await lookupIp("8.8.8.8");
    expect(info).toEqual({
      country: "UA",
      city: "Kyiv",
      asn: null,
      isp: null,
    });
  });

  it("survives an `org` without an AS prefix (sets isp, asn=null)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ country: "UA", city: "Kyiv", org: "Vodafone Ukraine" }),
    );
    const info = await lookupIp("8.8.8.8");
    expect(info).toEqual({
      country: "UA",
      city: "Kyiv",
      asn: null,
      isp: "Vodafone Ukraine",
    });
  });

  it("survives a thrown fetch (network error / abort)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    const info = await lookupIp("8.8.8.8");
    expect(info).toEqual(EMPTY);
  });

  it("caches successful responses (second call → no extra fetch)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ country: "UA", city: "Kyiv", org: "AS1 Foo" }),
    );
    await lookupIp("8.8.8.8");
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
