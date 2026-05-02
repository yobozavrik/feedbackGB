/**
 * SLA helpers shared between the dashboard KPI card ("Прострочено") and the
 * feed table column ("Висить"). All thresholds are expressed in hours so they
 * read naturally in code; constants are derived in milliseconds for easy diffs
 * against `Date.getTime()`.
 *
 * "Open" means a feedback row still requires admin attention — i.e. `status`
 * is one of `new` / `in_progress`. Resolved/rejected rows are considered
 * frozen and don't accrue age.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Buckets, ordered from least to most severe. */
export const AGING_HOURS = {
  /** Below 4h: still warm, no warning shown. */
  warm: 4,
  /** 4h – 24h: gold tag, "stale" tier. */
  stale: 24,
  /** 24h – 72h: orange tag, "overdue" — also feeds the KPI card. */
  overdue: 72,
  /** > 72h: red tag, "critical". */
} as const;

/** Anything older than this is considered overdue (for the dashboard KPI). */
export const OVERDUE_HOURS = AGING_HOURS.stale;

const OPEN_STATUSES = new Set(["new", "in_progress"]);

export function isOpen(status: string | null | undefined): boolean {
  return !!status && OPEN_STATUSES.has(status);
}

export function ageMs(createdAt: string, now = Date.now()): number {
  return Math.max(0, now - new Date(createdAt).getTime());
}

export type AgingBucket = "warm" | "stale" | "overdue" | "critical";

export function bucketFor(ms: number): AgingBucket {
  if (ms < AGING_HOURS.warm * HOUR_MS) return "warm";
  if (ms < AGING_HOURS.stale * HOUR_MS) return "stale";
  if (ms < AGING_HOURS.overdue * HOUR_MS) return "overdue";
  return "critical";
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return `${n} дні`;
  return `${n} днів`;
}

/** Short Ukrainian label like "12 хв", "5 год", "3 дні", "11 днів". */
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} хв`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 24) return `${hours} год`;
  return pluralDays(Math.floor(ms / DAY_MS));
}
