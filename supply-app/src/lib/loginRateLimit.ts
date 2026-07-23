import { getServerSupabase } from "@/lib/supabase";
import { createHmac } from "crypto";
import { getSessionSecret } from "@/lib/session";

const buckets = new Map<string, number[]>();

function fallback(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  const ok = hits.length < limit;
  if (ok) hits.push(now);
  buckets.set(key, hits);
  return { ok, resetMs: Math.max(0, windowMs - (now - (hits[0] ?? now))) };
}

export function requestIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function limitLogin(key: string, limit: number, windowMs: number) {
  const supabase = getServerSupabase();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") throw new Error("Rate limiter is unavailable.");
    return fallback(key, limit, windowMs);
  }
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: Math.ceil(windowMs / 1000),
  });
  if (error || !data) {
    if (process.env.NODE_ENV === "production") throw new Error("Rate limiter is unavailable.");
    return fallback(key, limit, windowMs);
  }
  return { ok: Boolean(data.ok), resetMs: Number(data.reset_ms ?? windowMs) };
}

export function pinBucket(pin: string): string {
  return `supply:pin:${createHmac("sha256", getSessionSecret()).update(pin).digest("hex")}`;
}
