import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __cacheSizeForTests,
  __resetGeoipCacheForTests,
  countryFlag,
  formatGeoLines,
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
    // multicast / broadcast / TEST-NET / benchmark / reserved
    "224.0.0.1",
    "239.255.255.255",
    "255.255.255.255",
    "192.0.2.1", // TEST-NET-1
    "198.51.100.1", // TEST-NET-2
    "203.0.113.1", // TEST-NET-3
    "198.18.0.1", // benchmark
    "240.0.0.1", // reserved
    "192.88.99.1", // 6to4 anycast
    // IPv6 multicast / documentation
    "ff02::1",
    "ff05::1:3",
    "2001:db8::1",
    "2001:db8:1234::beef",
  ])("treats %s as private/local", (ip) => {
    expect(isPrivateOrLocal(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "94.158.55.10",
    "::ffff:8.8.8.8", // IPv4-mapped IPv6 of public IP
    "172.32.0.1", // not in 16-31 range
    "192.169.0.1", // off-by-one from 192.168
    "100.63.0.1", // off-by-one from CGNAT
    "2001:4860:4860::8888", // Google public DNS
    "192.0.43.10", // ICANN — globally routable, NOT in the 192.0.0/24 or 192.0.2/24 reserved blocks
    "192.0.1.1", // routable, between IETF and TEST-NET-1
    "192.0.100.1"
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

  it("parses a bare 'AS<N>' (no whitespace, no name) as asn-only", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ country: "UA", city: "Kyiv", org: "AS15169" }),
    );
    const info = await lookupIp("8.8.8.8");
    expect(info).toEqual({
      country: "UA",
      city: "Kyiv",
      asn: "AS15169",
      isp: null,
    });
  });

  it("calls fetch with the URL-encoded IP and no query string", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ country: "UA" }));
    await lookupIp("8.8.8.8");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://ipinfo.io/8.8.8.8");
  });

  it("warns exactly once when IPINFO_TOKEN is unset across many calls", async () => {
    delete process.env.IPINFO_TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await lookupIp("8.8.8.8");
    await lookupIp("1.1.1.1");
    await lookupIp("4.4.4.4");
    const tokenWarnings = warn.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("IPINFO_TOKEN"),
    );
    expect(tokenWarnings).toHaveLength(1);
    warn.mockRestore();
  });
});

describe("lookupIp — cache TTL + timeout (with fake timers)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    __resetGeoipCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.IPINFO_TOKEN = "test_token_xxx";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.IPINFO_TOKEN;
  });

  it("successful response is cached for 24h, then re-fetched", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ country: "UA", city: "Kyiv", org: "AS1 Foo" }),
    );
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Just under 24h — still cached.
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Past 24h — cache miss.
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("failed response is cached for only 5min, not 24h", async () => {
    fetchMock.mockResolvedValue(errResponse(503));
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 4min later — still in failure cache.
    vi.advanceTimersByTime(4 * 60 * 1000);
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 6min total — expired.
    vi.advanceTimersByTime(2 * 60 * 1000);
    await lookupIp("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts the fetch after FETCH_TIMEOUT_MS and returns EMPTY", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal as
            | AbortSignal
            | undefined;
          signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const promise = lookupIp("8.8.8.8");
    // Trigger the AbortController.
    await vi.advanceTimersByTimeAsync(900);
    const info = await promise;
    expect(info).toEqual(EMPTY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("formatGeoLines", () => {
  it("returns empty=true when all four fields are empty", () => {
    expect(
      formatGeoLines({ country: null, city: null, asn: null, isp: null }),
    ).toEqual({ cityCountry: null, ispAsn: null, empty: true });
    expect(formatGeoLines(null)).toEqual({
      cityCountry: null,
      ispAsn: null,
      empty: true,
    });
    expect(formatGeoLines(undefined)).toEqual({
      cityCountry: null,
      ispAsn: null,
      empty: true,
    });
  });

  it("joins city + country with a comma when both present", () => {
    expect(
      formatGeoLines({
        city: "Kyiv",
        country: "UA",
        isp: "Vodafone",
        asn: "AS15895",
      }),
    ).toEqual({
      cityCountry: "Kyiv, UA",
      ispAsn: "Vodafone · AS15895",
      empty: false,
    });
  });

  it("shows just city when no country", () => {
    expect(
      formatGeoLines({
        city: "Kyiv",
        country: null,
        isp: null,
        asn: null,
      }).cityCountry,
    ).toBe("Kyiv");
  });

  it("shows just country when no city", () => {
    expect(
      formatGeoLines({
        city: null,
        country: "UA",
        isp: null,
        asn: null,
      }).cityCountry,
    ).toBe("UA");
  });

  it("joins isp + asn with separator when both present, just one when one", () => {
    expect(
      formatGeoLines({
        city: null,
        country: null,
        isp: "Vodafone",
        asn: null,
      }).ispAsn,
    ).toBe("Vodafone");
    expect(
      formatGeoLines({
        city: null,
        country: null,
        isp: null,
        asn: "AS15895",
      }).ispAsn,
    ).toBe("AS15895");
  });
});

describe("cache hard cap", () => {
  it("keeps the cache from growing unbounded under sustained miss-rate", async () => {
    __resetGeoipCacheForTests();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(okResponse({ country: "XX" }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.IPINFO_TOKEN = "test_token_xxx";
    try {
      // 5100 distinct IPs > MAX_CACHE_ENTRIES (5000).
      for (let i = 0; i < 5100; i++) {
        const a = (i >> 8) & 0xff;
        const b = i & 0xff;
        await lookupIp(`8.8.${a}.${b}`);
      }
      expect(__cacheSizeForTests()).toBeLessThanOrEqual(5000);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.IPINFO_TOKEN;
      __resetGeoipCacheForTests();
    }
  });
});
