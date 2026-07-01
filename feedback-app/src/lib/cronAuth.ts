import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared bearer-token check for the /api/cron/* Vercel Cron entrypoints.
 * Both routes previously duplicated this exact logic with a plain `!==`
 * string comparison, which leaks timing information proportional to how
 * many leading bytes of the guess matched the real secret.
 *
 * `node:crypto`'s `timingSafeEqual` throws if the two buffers differ in
 * length (a realistic case here — a guessed token is very unlikely to be
 * exactly CRON_SECRET's length), and comparing unequal-length values
 * without it would itself leak length. Hashing both sides to a fixed
 * 32-byte digest first sidesteps both problems: same-length inputs,
 * genuinely constant-time compare, standard mitigation for this exact
 * scenario.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every
 * scheduled invocation. Ad-hoc/manual calls to these endpoints (ops,
 * debugging) must present the same header.
 *
 * When CRON_SECRET isn't configured at all: allowed outside production
 * (local dev convenience), but in production only Vercel's own
 * `x-vercel-cron: 1` request is trusted — anything else is rejected so
 * the endpoint doesn't run wide open just because the env var was never
 * set.
 */
export function checkCronAuth(req: Request): CronAuthResult {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (cronSecret) {
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!timingSafeEqualStrings(provided, cronSecret)) {
      return { ok: false, status: 401, error: "unauthenticated" };
    }
    return { ok: true };
  }

  if (process.env.NODE_ENV === "production" && !isVercelCron) {
    return { ok: false, status: 503, error: "cron_secret_not_configured" };
  }

  return { ok: true };
}
