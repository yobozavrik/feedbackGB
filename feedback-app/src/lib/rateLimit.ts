/**
 * Tiny sliding-window rate limiter.
 *
 * On Vercel serverless this is per-instance (best-effort), so deploy with
 * Upstash Redis when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * available. The in-memory fallback is intentional — it's enough to kill
 * dumb brute-force loops from a single box and falls back gracefully on
 * cold starts.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  reset_ms: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  const ok = b.hits.length < limit;
  if (ok) b.hits.push(now);
  buckets.set(key, b);

  // Basic GC so the map doesn't grow forever in long-lived runtimes.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.length === 0 || now - v.hits[v.hits.length - 1] > windowMs) {
        buckets.delete(k);
      }
    }
  }

  const oldest = b.hits[0] ?? now;
  return {
    ok,
    remaining: Math.max(0, limit - b.hits.length),
    reset_ms: Math.max(0, windowMs - (now - oldest)),
  };
}

/**
 * Extract the best-effort client IP from a Next.js Request.
 * Trusts the standard Vercel / proxy headers; falls back to "unknown".
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const xfwd = h.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0]!.trim();
  return (
    h.get("x-real-ip") ||
    h.get("x-vercel-forwarded-for") ||
    h.get("cf-connecting-ip") ||
    "unknown"
  );
}
