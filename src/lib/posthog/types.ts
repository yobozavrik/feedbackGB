/**
 * Shape of a single funnel step as returned to the client.
 *
 * `count`         — absolute number of users who reached this step.
 * `dropOffCount`  — number of users who reached the previous step but did
 *                   not reach this one (always 0 for the first step).
 * `dropOffPct`    — `dropOffCount / previous.count`, rounded to 1 decimal.
 *                   0 for the first step. 100 if previous step had 0 users.
 * `convFromStart` — share of users from step 0 who reached this step
 *                   (cumulative conversion).
 */
export interface FunnelStep {
  /** Stable event name from `src/lib/analytics.ts` AnalyticsEvent union. */
  event: string;
  /** Human-readable label rendered in the UI. */
  label: string;
  count: number;
  dropOffCount: number;
  dropOffPct: number;
  convFromStart: number;
}

/**
 * Single user/session that started the funnel within the time window but
 * hasn't completed the last step yet. Used to populate the "Хто застряг"
 * table on `/admin/funnel`.
 */
export interface StuckSession {
  /** PostHog distinct_id, OR the backend user UUID we identified earlier. */
  distinctId: string;
  /** Best-effort human label (full_name from PostHog person properties). */
  label: string | null;
  /** Last completed funnel step (event name). */
  lastEvent: string;
  /** ISO timestamp of when the funnel was last advanced. */
  lastSeenAt: string;
  /** Hours since `lastSeenAt`. */
  hoursAgo: number;
}

/**
 * Drop-off heatmap cell. The matrix is keyed by `dayOfWeek` (0=Sunday, 1=Mon, …)
 * and `hour` (0–23). `dropOffPct` = % of users who started but didn't finish
 * within the (day, hour) bucket.
 */
export interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  starts: number;
  completes: number;
  dropOffPct: number;
}

/**
 * Complete server response for `GET /api/admin/funnel?period=…`.
 */
export interface FunnelResponse {
  /** UTC ISO timestamp the snapshot was generated at. */
  generatedAt: string;
  /** Window in days (7, 30, or 90). */
  periodDays: number;
  steps: FunnelStep[];
  stuck: StuckSession[];
  heatmap: HeatmapCell[];
  /** When PostHog isn't configured / API call fails, all arrays are empty
   *  and this string explains why. */
  error: string | null;
}
