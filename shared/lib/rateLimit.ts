// supabase.ts stays per-app (it imports @supabase/supabase-js from the app's
// node_modules); the @/* alias resolves to the compiling app's own copy.
import { getServerSupabase } from "@/lib/supabase";

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  reset_ms: number;
}

/**
 * Fallback sliding-window in-memory rate limiter (used in development/localhost).
 */
function fallbackRateLimit(
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
 * Distributed database-backed rate limiter for production.
 * Falls back to in-memory only in local development (non-production) mode.
 * Fails closed in production if database is unreachable.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const isProd = process.env.NODE_ENV === "production";
  const supabase = getServerSupabase();

  if (!supabase) {
    if (isProd) {
      throw new Error("Supabase client is unavailable in production rate limiter (fail-closed).");
    }
    return fallbackRateLimit(key, limit, windowMs);
  }

  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));

  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error("DB rate limit RPC error:", error);
      if (isProd) {
        throw new Error(`DB rate limit RPC failed in production: ${error.message}`);
      }
      return fallbackRateLimit(key, limit, windowMs);
    }

    return {
      ok: Boolean(data.ok),
      remaining: Number(data.remaining),
      reset_ms: Number(data.reset_ms),
    };
  } catch (e) {
    console.error("DB rate limit exception:", e);
    if (isProd) {
      throw e;
    }
    return fallbackRateLimit(key, limit, windowMs);
  }
}

/**
 * Extract the client IP from a platform-controlled header when present. For a
 * generic proxy chain the last X-Forwarded-For hop is the one appended by the
 * trusted proxy; never use the attacker-controlled first hop.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const vercel = h.get("x-vercel-forwarded-for");
  if (vercel) return vercel.trim();
  const cloudflare = h.get("cf-connecting-ip");
  if (cloudflare) return cloudflare.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const xfwd = h.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",").at(-1)!.trim();
  return "unknown";
}

/** Reads a distributed limit without consuming an attempt. Use this before a
 * credential verifier so a blocked source cannot make an expensive RPC call. */
export async function rateLimitStatus(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const supabase = getServerSupabase();
  const isProd = process.env.NODE_ENV === "production";
  if (!supabase) {
    if (isProd) throw new Error("Supabase client is unavailable in production rate limiter.");
    return fallbackRateLimitStatus(key, limit, windowMs);
  }
  try {
    const { data, error } = await supabase.rpc("get_rate_limit_status", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
    });
    if (error) throw new Error(`DB rate limit status RPC failed: ${error.message}`);
    return { ok: Boolean(data.ok), remaining: Number(data.remaining), reset_ms: Number(data.reset_ms) };
  } catch (error) {
    if (isProd) throw error;
    return fallbackRateLimitStatus(key, limit, windowMs);
  }
}

function fallbackRateLimitStatus(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => now - t < windowMs);
  const oldest = hits[0] ?? now;
  return { ok: hits.length < limit, remaining: Math.max(0, limit - hits.length), reset_ms: Math.max(0, windowMs - (now - oldest)) };
}
