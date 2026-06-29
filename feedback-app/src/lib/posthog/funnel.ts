/**
 * Business logic for the /admin/funnel page.
 *
 * Composes a fixed funnel definition (matching the order of events fired
 * during the seller's flow in the Mini App), runs three independent
 * PostHog queries (funnel counts, stuck sessions, drop-off heatmap) and
 * normalises them into the {@link FunnelResponse} shape.
 *
 * Each query is independently failure-tolerant: if PostHog 5xx-s on the
 * heatmap, we still return funnel + stuck and a non-null `error`.
 */
import {
  formatPosthogError,
  PosthogConfigError,
  runQuery,
} from "./api";
import type {
  FunnelResponse,
  FunnelStep,
  HeatmapCell,
  StuckSession,
} from "./types";

/**
 * The seller's primary flow as a strict event chain. Order matters —
 * PostHog FunnelsQuery treats each entry as a step that must follow the
 * previous one chronologically per user.
 */
const FUNNEL_EVENTS: { event: string; label: string }[] = [
  { event: "login_pin_input_started", label: "Відкрив екран PIN" },
  { event: "login_submit_click", label: "Натиснув Увійти" },
  { event: "login_success", label: "Успішний логін" },
  { event: "home_category_open", label: "Обрав категорію" },
  { event: "feedback_form_started", label: "Відкрив форму" },
  { event: "feedback_submit_click", label: "Натиснув Надіслати" },
  { event: "feedback_submit_success", label: "Фідбек збережено" },
];

/** Maximum days the UI lets the user pick. Anything past this we floor. */
const ALLOWED_PERIOD_DAYS = [7, 30, 90] as const;
export type PeriodDays = (typeof ALLOWED_PERIOD_DAYS)[number];

export function isPeriodDays(value: unknown): value is PeriodDays {
  return ALLOWED_PERIOD_DAYS.includes(value as PeriodDays);
}

interface FunnelsQueryResult {
  results: Array<
    | {
        action_id?: string;
        name?: string;
        count: number;
        order: number;
      }
    | Array<{ action_id?: string; name?: string; count: number; order: number }>
  >;
}

/** Pull the flat list of step counts out of a possibly-nested PostHog response. */
function flattenFunnelResults(
  raw: FunnelsQueryResult,
): Array<{ name: string; count: number; order: number }> {
  const flat: Array<{ name: string; count: number; order: number }> = [];
  for (const entry of raw.results ?? []) {
    if (Array.isArray(entry)) {
      // Funnel queries with breakdowns return an array of arrays. We only
      // care about the first variant (no breakdown) for the headline funnel.
      for (const inner of entry) {
        flat.push({
          name: inner.action_id ?? inner.name ?? "",
          count: inner.count ?? 0,
          order: inner.order,
        });
      }
      break;
    } else {
      flat.push({
        name: entry.action_id ?? entry.name ?? "",
        count: entry.count ?? 0,
        order: entry.order,
      });
    }
  }
  return flat;
}

async function fetchFunnelCounts(periodDays: PeriodDays): Promise<FunnelStep[]> {
  const raw = await runQuery<FunnelsQueryResult>({
    kind: "FunnelsQuery",
    series: FUNNEL_EVENTS.map(({ event }) => ({
      kind: "EventsNode",
      event,
    })),
    dateRange: { date_from: `-${periodDays}d` },
  });
  const flat = flattenFunnelResults(raw);
  // Map by event name to be resilient to ordering quirks.
  const byEvent = new Map(flat.map((row) => [row.name, row.count]));
  const startCount = byEvent.get(FUNNEL_EVENTS[0]?.event ?? "") ?? 0;

  const steps: FunnelStep[] = FUNNEL_EVENTS.map(({ event, label }, i) => {
    const count = byEvent.get(event) ?? 0;
    const prevCount =
      i === 0 ? count : (byEvent.get(FUNNEL_EVENTS[i - 1].event) ?? 0);
    const dropOffCount = i === 0 ? 0 : Math.max(0, prevCount - count);
    const dropOffPct =
      i === 0 ? 0 : prevCount > 0 ? (dropOffCount / prevCount) * 100 : 0;
    const convFromStart =
      startCount > 0 ? (count / startCount) * 100 : 0;
    return {
      event,
      label,
      count,
      dropOffCount,
      dropOffPct: Math.round(dropOffPct * 10) / 10,
      convFromStart: Math.round(convFromStart * 10) / 10,
    };
  });
  return steps;
}

interface HogqlResponse {
  results: unknown[][];
  columns?: string[];
}

async function fetchStuckSessions(
  periodDays: PeriodDays,
): Promise<StuckSession[]> {
  // "Stuck" = users who started the funnel within the last 24h but did NOT
  // emit `feedback_submit_success` since their first start, AND haven't
  // emitted any of our funnel events for >2h. We surface up to 50.
  const stuckEvents = FUNNEL_EVENTS.map((s) => `'${s.event}'`).join(", ");
  const sql = `
    SELECT
      e.distinct_id,
      argMax(e.event, e.timestamp) AS last_event,
      max(e.timestamp) AS last_seen,
      argMax(person.properties.full_name, e.timestamp) AS full_name
    FROM events e
    LEFT JOIN persons person ON person.id = e.person_id
    WHERE e.timestamp > now() - INTERVAL ${periodDays} DAY
      AND e.event IN (${stuckEvents})
    GROUP BY e.distinct_id
    HAVING (last_seen < now() - INTERVAL 2 HOUR)
       AND (last_event != 'feedback_submit_success')
       AND (last_seen > now() - INTERVAL 24 HOUR)
    ORDER BY last_seen DESC
    LIMIT 50
  `;
  const raw = await runQuery<HogqlResponse>({
    kind: "HogQLQuery",
    query: sql,
  });
  const rows = raw.results ?? [];
  return rows.map((row) => {
    const [distinctId, lastEvent, lastSeen, fullName] = row as [
      string,
      string,
      string,
      string | null,
    ];
    const lastSeenAt = new Date(lastSeen).toISOString();
    const hoursAgo = Math.max(
      0,
      (Date.now() - new Date(lastSeenAt).getTime()) / 3_600_000,
    );
    return {
      distinctId,
      label: fullName || null,
      lastEvent,
      lastSeenAt,
      hoursAgo: Math.round(hoursAgo * 10) / 10,
    };
  });
}

async function fetchHeatmap(periodDays: PeriodDays): Promise<HeatmapCell[]> {
  // For each (day-of-week, hour) bucket count how many sessions started the
  // funnel and how many also reached the success event. drop_off_pct is
  // 1 - completes/starts (rounded to 1 decimal).
  const startEvent = FUNNEL_EVENTS[0]?.event ?? "";
  const finishEvent = FUNNEL_EVENTS[FUNNEL_EVENTS.length - 1]?.event ?? "";
  const sql = `
    WITH starts AS (
      SELECT
        toDayOfWeek(timestamp) AS dow,
        toHour(timestamp) AS hr,
        count() AS n
      FROM events
      WHERE event = '${startEvent}'
        AND timestamp > now() - INTERVAL ${periodDays} DAY
      GROUP BY dow, hr
    ),
    finishes AS (
      SELECT
        toDayOfWeek(timestamp) AS dow,
        toHour(timestamp) AS hr,
        count() AS n
      FROM events
      WHERE event = '${finishEvent}'
        AND timestamp > now() - INTERVAL ${periodDays} DAY
      GROUP BY dow, hr
    )
    SELECT
      starts.dow,
      starts.hr,
      starts.n AS starts,
      coalesce(finishes.n, 0) AS completes
    FROM starts
    LEFT JOIN finishes
      ON starts.dow = finishes.dow AND starts.hr = finishes.hr
    ORDER BY starts.dow, starts.hr
  `;
  const raw = await runQuery<HogqlResponse>({
    kind: "HogQLQuery",
    query: sql,
  });
  const rows = raw.results ?? [];
  return rows.map((row) => {
    const [dow, hr, starts, completes] = row as [
      number,
      number,
      number,
      number,
    ];
    // ClickHouse `toDayOfWeek` returns 1=Monday … 7=Sunday. Normalise to
    // JS-style 0=Sun, 1=Mon, … 6=Sat.
    const dayOfWeek = dow === 7 ? 0 : dow;
    const dropOffPct =
      starts > 0 ? Math.max(0, ((starts - completes) / starts) * 100) : 0;
    return {
      dayOfWeek,
      hour: hr,
      starts,
      completes,
      dropOffPct: Math.round(dropOffPct * 10) / 10,
    };
  });
}

/**
 * Public entry point: build the full FunnelResponse for the given period.
 * Never throws — degrades gracefully when PostHog is unreachable or when
 * the personal API key is missing.
 */
export async function buildFunnelSnapshot(
  periodDays: PeriodDays,
): Promise<FunnelResponse> {
  const generatedAt = new Date().toISOString();
  // Short-circuit: if no key, return empty payload with friendly message.
  if (!process.env.POSTHOG_PERSONAL_API_KEY) {
    return {
      generatedAt,
      periodDays,
      steps: [],
      stuck: [],
      heatmap: [],
      error:
        "POSTHOG_PERSONAL_API_KEY не налаштовано — серверні запити до PostHog вимкнено.",
    };
  }

  let error: string | null = null;
  let steps: FunnelStep[] = [];
  let stuck: StuckSession[] = [];
  let heatmap: HeatmapCell[] = [];

  try {
    steps = await fetchFunnelCounts(periodDays);
  } catch (err) {
    if (err instanceof PosthogConfigError) {
      // Bail early — a config error means the other two queries will fail
      // for the exact same reason.
      return {
        generatedAt,
        periodDays,
        steps: [],
        stuck: [],
        heatmap: [],
        error: formatPosthogError(err),
      };
    }
    error = `Воронка: ${formatPosthogError(err)}`;
  }

  try {
    stuck = await fetchStuckSessions(periodDays);
  } catch (err) {
    error = error
      ? `${error}; Хто застряг: ${formatPosthogError(err)}`
      : `Хто застряг: ${formatPosthogError(err)}`;
  }

  try {
    heatmap = await fetchHeatmap(periodDays);
  } catch (err) {
    error = error
      ? `${error}; Heatmap: ${formatPosthogError(err)}`
      : `Heatmap: ${formatPosthogError(err)}`;
  }

  return {
    generatedAt,
    periodDays,
    steps,
    stuck,
    heatmap,
    error,
  };
}
