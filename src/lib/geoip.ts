/**
 * Server-side IP enrichment via ipinfo.io.
 *
 * Free tier: 50k requests/month. Returns country, city, ASN and ISP for a
 * given IP. Used by /api/auth/login to enrich both audit_log entries and
 * the cached `last_login_*` columns on the users table.
 *
 * Caching:
 *   - Successful responses cached for 24h (per process, per IP) so a
 *     single user logging in repeatedly costs at most one API call/day.
 *   - Failures (timeout, non-2xx, throw) are still cached but only for
 *     5 minutes so a transient outage doesn't blackhole an IP for a day.
 *   - In-flight requests are deduplicated: two concurrent `lookupIp(ip)`
 *     calls for the same IP share a single fetch.
 *   - Hard cap of 5000 entries with periodic LRU-like eviction so the
 *     map can never grow unbounded on long-lived runtimes.
 *
 * Privacy/skipping: private/loopback/IPv6 link-local/CGNAT/multicast/
 * documentation addresses are resolved locally to EMPTY without hitting
 * the API — there is no useful geo data for those, and we don't want
 * to count quota.
 *
 * Auth: token is sent in the Authorization header (not the URL query
 * string) so it doesn't leak into provider/CDN access logs. A missing
 * token logs a single warning and returns EMPTY for every call.
 *
 * VPN / proxy / Tor / datacenter classification is intentionally out of
 * scope for this module. Adding it requires a second provider (e.g.
 * ipqualityscore, ipapi.is) and is tracked as a future "Etap 2".
 */
const ENV_IPINFO = "IPINFO_TOKEN";

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 800;
const MAX_CACHE_ENTRIES = 5000;

export interface GeoIpInfo {
  country: string | null;
  city: string | null;
  asn: string | null;
  isp: string | null;
}

interface CacheEntry {
  /** Resolved value if `pending` is undefined; otherwise EMPTY. */
  value: GeoIpInfo;
  /** When a resolved entry expires. Ignored while `pending` is set. */
  expiresAt: number;
  /** In-flight promise — concurrent callers share it. */
  pending?: Promise<GeoIpInfo>;
}

const cache = new Map<string, CacheEntry>();

/** Empty result used as the default + for private/skipped IPs. */
const EMPTY: GeoIpInfo = {
  country: null,
  city: null,
  asn: null,
  isp: null,
};

/**
 * Strip an IPv6 zone identifier (`%eth0`) and the IPv4-mapped-IPv6
 * prefix (`::ffff:1.2.3.4` → `1.2.3.4`). Lowercase the result so the
 * private-IP detector below is case-insensitive on IPv6.
 */
function normalizeIp(raw: string): string {
  if (!raw) return "";
  let ip = raw.trim().toLowerCase();
  // Drop IPv6 zone id ("fe80::1%eth0").
  const pct = ip.indexOf("%");
  if (pct >= 0) ip = ip.slice(0, pct);
  // IPv4-mapped IPv6 → bare IPv4.
  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice("::ffff:".length);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) ip = v4;
  }
  return ip;
}

/**
 * Best-effort detection of private / internal / non-routable IPs. Used
 * to short-circuit `lookupIp` so we don't spend API quota on RFC1918,
 * loopback, link-local, CGNAT, multicast, broadcast, TEST-NET, IPv6
 * unique-local / link-local / multicast / documentation addresses.
 */
export function isPrivateOrLocal(rawIp: string): boolean {
  if (!rawIp) return true;
  const ip = normalizeIp(rawIp);
  if (!ip) return true;
  if (ip === "unknown") return true;
  // IPv6 loopback / unspecified.
  if (ip === "::1" || ip === "::") return true;
  // Bare IPv4.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    const a = parts[0];
    const b = parts[1];
    if (a === undefined || b === undefined) return true;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    // 192.0.0.0/24 (IETF protocol assignments) + 192.0.2.0/24 (TEST-NET-1).
    // Crucially NOT 192.0.0.0/16 — e.g. 192.0.43.10 is ICANN's globally
    // routable space.
    if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    if (a === 192 && b === 88 && parts[2] === 99) return true; // 6to4 anycast
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
    if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255 broadcast
    return false;
  }
  // IPv6 (already lowercased).
  if (ip.startsWith("fe80:")) return true; // link-local fe80::/10
  // Unique-local fc00::/7 → first byte 0xfc or 0xfd.
  if (/^f[cd][0-9a-f]{0,2}:/.test(ip)) return true;
  // Multicast ff00::/8.
  if (/^ff[0-9a-f]{0,2}:/.test(ip)) return true;
  // Documentation 2001:db8::/32.
  if (ip.startsWith("2001:db8:") || ip === "2001:db8::") return true;
  return false;
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

interface IpinfoLite {
  city?: unknown;
  country?: unknown;
  org?: unknown;
}

/**
 * Defensively coerce a value that we expect to be a string.
 * Returns null if it's not a non-empty string.
 */
function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Split "AS15169 Google LLC" into asn + isp. Handles three shapes:
 *   - "AS15169 Google LLC" → { asn: "AS15169", isp: "Google LLC" }
 *   - "AS15169"            → { asn: "AS15169", isp: null }
 *   - "Google LLC"         → { asn: null,      isp: "Google LLC" }
 */
function parseOrg(raw: unknown): { asn: string | null; isp: string | null } {
  const org = asString(raw);
  if (!org) return { asn: null, isp: null };
  const withName = /^(AS\d+)\s+(.*)$/i.exec(org);
  if (withName) {
    return { asn: withName[1] ?? null, isp: asString(withName[2]) };
  }
  const bareAs = /^AS\d+$/i.exec(org);
  if (bareAs) return { asn: org, isp: null };
  return { asn: null, isp: org };
}

/**
 * Track whether we've already warned about a missing IPINFO_TOKEN, so
 * the warning fires exactly once per process lifetime instead of on
 * every login.
 */
let missingTokenWarned = false;

async function fetchIpinfo(ip: string): Promise<GeoIpInfo> {
  const token = process.env[ENV_IPINFO];
  if (!token) {
    if (!missingTokenWarned) {
      missingTokenWarned = true;
      console.warn(
        "[geoip] IPINFO_TOKEN unset — geo enrichment disabled (set the env var to enable)",
      );
    }
    return EMPTY;
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://ipinfo.io/${encodeURIComponent(ip)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );
  } catch (err) {
    console.warn("[geoip] ipinfo fetch threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return EMPTY;
  }
  if (!res.ok) {
    // 401 / 403 = bad/revoked token, 429 = quota exhausted, 5xx =
    // provider degradation. None of these are silently survivable —
    // surface them so on-call has a signal in logs.
    console.warn("[geoip] ipinfo non-2xx", { status: res.status });
    return EMPTY;
  }
  let json: IpinfoLite;
  try {
    json = (await res.json()) as IpinfoLite;
  } catch (err) {
    console.warn("[geoip] ipinfo JSON parse failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return EMPTY;
  }
  const country = asString(json.country);
  const city = asString(json.city);
  const { asn, isp } = parseOrg(json.org);
  return { country, city, asn, isp };
}

/** Mostly-LRU eviction: drop expired entries first, then oldest if still over cap. */
function evictIfNeeded(now: number): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  for (const [k, v] of cache) {
    if (!v.pending && v.expiresAt <= now) cache.delete(k);
  }
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop oldest insertion-order entries until under cap.
  const toDrop = cache.size - MAX_CACHE_ENTRIES;
  let dropped = 0;
  for (const k of cache.keys()) {
    if (dropped >= toDrop) break;
    const entry = cache.get(k);
    if (entry?.pending) continue; // never evict an in-flight entry
    cache.delete(k);
    dropped++;
  }
}

/**
 * Look up an IP address. Never throws — returns EMPTY on any failure.
 * Caches successful results for 24h, failures for 5min. Concurrent
 * calls for the same IP share a single in-flight fetch.
 */
export async function lookupIp(ip: string | null): Promise<GeoIpInfo> {
  if (!ip) return EMPTY;
  const key = normalizeIp(ip);
  if (!key || isPrivateOrLocal(key)) return EMPTY;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached) {
    if (cached.pending) return cached.pending;
    if (cached.expiresAt > now) return cached.value;
  }

  const pending = (async (): Promise<GeoIpInfo> => {
    let info: GeoIpInfo;
    try {
      info = await fetchIpinfo(key);
    } catch (err) {
      console.warn("[geoip] lookup failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      info = EMPTY;
    }
    const isEmpty =
      info.country === null &&
      info.city === null &&
      info.asn === null &&
      info.isp === null;
    cache.set(key, {
      expiresAt: Date.now() + (isEmpty ? FAILURE_TTL_MS : SUCCESS_TTL_MS),
      value: info,
    });
    evictIfNeeded(Date.now());
    return info;
  })();

  // Seed an in-flight placeholder so concurrent callers can find and
  // share `pending`. Identification is via `pending !== undefined`;
  // `expiresAt` is unused while pending is set.
  cache.set(key, { value: EMPTY, expiresAt: 0, pending });
  return pending;
}

/** Compact JSON shape that lands in audit_log.meta.geoip. */
export function geoipToAuditMeta(info: GeoIpInfo): Record<string, unknown> | null {
  if (
    info.country === null &&
    info.city === null &&
    info.asn === null &&
    info.isp === null
  ) {
    return null;
  }
  return {
    country: info.country,
    city: info.city,
    asn: info.asn,
    isp: info.isp,
  };
}

/**
 * Build a partial UPDATE payload for `users.last_login_*` that includes
 * only the columns whose new value is non-null. Returns null when no
 * field has data.
 *
 * Skipping null fields means a partial ipinfo response (e.g. country='UA'
 * but no city/isp) does not null out previously-stored richer data on
 * the user row — older richer data stays put until a fully-populated
 * response replaces it.
 */
export function geoipToUserUpdate(
  info: GeoIpInfo,
): {
  last_login_country?: string;
  last_login_city?: string;
  last_login_asn?: string;
  last_login_isp?: string;
} | null {
  const payload: {
    last_login_country?: string;
    last_login_city?: string;
    last_login_asn?: string;
    last_login_isp?: string;
  } = {};
  if (info.country) payload.last_login_country = info.country;
  if (info.city) payload.last_login_city = info.city;
  if (info.asn) payload.last_login_asn = info.asn;
  if (info.isp) payload.last_login_isp = info.isp;
  return Object.keys(payload).length > 0 ? payload : null;
}

/**
 * Convert ISO-2 country code to a regional-indicator flag emoji
 * ("UA" → 🇺🇦). Returns "" for invalid input. Used in admin UIs.
 */
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6;
  const upper = code.toUpperCase();
  const a = upper.charCodeAt(0);
  const b = upper.charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return "";
  return String.fromCodePoint(A + (a - 65), A + (b - 65));
}

/** Geo fields a UI cell needs to render. All fields optional + nullable. */
export interface GeoLikeFields {
  country?: string | null;
  city?: string | null;
  asn?: string | null;
  isp?: string | null;
}

/** Two short lines a UI cell wants to show: "Kyiv, UA" / "Vodafone · AS15895". */
export interface GeoLines {
  /** "City, Country" or just "City" or just "Country" or null. */
  cityCountry: string | null;
  /** "ISP · ASN" or just one or null. */
  ispAsn: string | null;
  /** Empty marker — true when none of the four fields are set. */
  empty: boolean;
}

/**
 * Format the four geo fields into the pair of strings the admin UIs
 * render. Both audit and users tables use this shared helper.
 */
export function formatGeoLines(geo: GeoLikeFields | null | undefined): GeoLines {
  const country = geo?.country || null;
  const city = geo?.city || null;
  const asn = geo?.asn || null;
  const isp = geo?.isp || null;
  const empty = !country && !city && !asn && !isp;
  let cityCountry: string | null = null;
  if (city && country) cityCountry = `${city}, ${country}`;
  else if (city) cityCountry = city;
  else if (country) cityCountry = country;
  const ispAsn = [isp, asn].filter(Boolean).join(" · ") || null;
  return { cityCountry, ispAsn, empty };
}

/** Test-only helpers. Do not use in production code paths. */
export function __resetGeoipCacheForTests(): void {
  cache.clear();
  missingTokenWarned = false;
}

export function __cacheSizeForTests(): number {
  return cache.size;
}
