/**
 * Server-side IP enrichment via ipinfo.io.
 *
 * Free tier: 50k requests/month. Returns country, city, ASN and ISP for a
 * given IP. Used by /api/auth/login to enrich both audit_log entries and
 * the cached `last_login_*` columns on the users table.
 *
 * Caching: per-process Map with 24h TTL keyed on the IP. A single user
 * logging in repeatedly costs at most one API call per day from this VM.
 *
 * Privacy/skipping: private/loopback/IPv6 link-local addresses are
 * resolved locally to {} without hitting the API — there is no useful
 * geo data for those, and we don't want to count quota.
 *
 * VPN / proxy / Tor / datacenter classification is intentionally out of
 * scope for this module. Adding it requires a second provider (e.g.
 * ipqualityscore, ipapi.is) and is tracked as a future "Etap 2".
 */
const ENV_IPINFO = "IPINFO_TOKEN";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

export interface GeoIpInfo {
  country: string | null;
  city: string | null;
  asn: string | null;
  isp: string | null;
}

interface CacheEntry {
  expiresAt: number;
  value: GeoIpInfo;
}

const cache = new Map<string, CacheEntry>();

/** Empty result used as the default + for private/skipped IPs. */
const EMPTY: GeoIpInfo = {
  country: null,
  city: null,
  asn: null,
  isp: null,
};

/** Best-effort detection of private/internal IPs. We don't want to spend
 *  API quota looking up RFC1918 / link-local / localhost addresses. */
function isPrivateOrLocal(ip: string): boolean {
  if (!ip) return true;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("169.254.")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local IPv6
  if (ip.startsWith("fe80:")) return true; // link-local IPv6
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
  city?: string;
  country?: string;
  org?: string; // "AS15169 Google LLC"
}

async function fetchIpinfo(ip: string): Promise<GeoIpInfo> {
  const token = process.env[ENV_IPINFO];
  if (!token) return EMPTY;
  const res = await fetchWithTimeout(
    `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) return EMPTY;
  const json = (await res.json()) as IpinfoLite;
  // Split "AS15169 Google LLC" → asn="AS15169", isp="Google LLC".
  let asn: string | null = null;
  let isp: string | null = null;
  if (json.org) {
    const match = /^(AS\d+)\s+(.*)$/i.exec(json.org.trim());
    if (match) {
      asn = match[1];
      isp = match[2];
    } else {
      isp = json.org;
    }
  }
  return {
    country: json.country ?? null,
    city: json.city ?? null,
    asn,
    isp,
  };
}

/**
 * Look up an IP address. Never throws — returns {@link EMPTY} on any
 * failure. Caches successful results for 24h per IP.
 */
export async function lookupIp(ip: string | null): Promise<GeoIpInfo> {
  if (!ip || isPrivateOrLocal(ip)) return EMPTY;
  const now = Date.now();
  const cached = cache.get(ip);
  if (cached && cached.expiresAt > now) return cached.value;

  let info: GeoIpInfo;
  try {
    info = await fetchIpinfo(ip);
  } catch (err) {
    console.warn("[geoip] ipinfo lookup failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return EMPTY;
  }

  cache.set(ip, { expiresAt: now + CACHE_TTL_MS, value: info });
  // Keep the cache from growing unbounded for high-traffic deployments.
  if (cache.size > 5000) {
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }
  return info;
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
