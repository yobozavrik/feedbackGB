/** One source of calendar semantics for prices, sales and foodcost.
 * Pure and safe for client/server. Does not fetch Poster or start ingestion. */
export const ANALYTICS_HISTORY_START = "2026-01-01";
export const ANALYTICS_TIMEZONE = "Europe/Kyiv";
export const ANALYTICS_PRESETS = ["today", "yesterday", "7d", "14d", "30d", "60d", "90d",
  "month", "previous-month", "quarter", "ytd", "all", "custom"] as const;
export type AnalyticsPreset = typeof ANALYTICS_PRESETS[number];
export type AnalyticsGrain = "day" | "week" | "month";
export type AnalyticsDateWindow = { from: string; to: string; dates: string[] };
export type AnalyticsPeriod = {
  preset: AnalyticsPreset;
  timezone: typeof ANALYTICS_TIMEZONE;
  historyStart: typeof ANALYTICS_HISTORY_START;
  resolvedAt: string;
  requested: AnalyticsDateWindow;
  closed: AnalyticsDateWindow | null;
  provisionalDate: string | null;
  grain: AnalyticsGrain;
  comparisonMode: "previous" | "custom" | "off";
  comparison: {
    status: "available" | "unavailable" | "disabled";
    window: AnalyticsDateWindow | null;
    reason: "before_history_start" | "no_closed_days" | "disabled" | null;
  };
};

const MS_DAY = 86400000;
const PERIOD_QUERY_KEYS = ["period", "days", "from", "to", "grain", "comparison", "compare_from", "compare_to"];

export function analyticsIsoDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value) throw new Error("invalid_analytics_date");
  return value;
}

export function analyticsAddDays(value: string, offset: number): string {
  analyticsIsoDate(value);
  if (!Number.isSafeInteger(offset)) throw new Error("invalid_analytics_date");
  const shifted = new Date(Date.parse(`${value}T00:00:00Z`) + offset * MS_DAY);
  if (!Number.isFinite(shifted.getTime())) throw new Error("invalid_analytics_date");
  return analyticsIsoDate(shifted.toISOString().slice(0, 10));
}

export function analyticsKyivDate(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("invalid_analytics_clock");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ANALYTICS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (kind: string) => parts.find(row => row.type === kind)?.value;
  return analyticsIsoDate(`${part("year")}-${part("month")}-${part("day")}`);
}

export function analyticsWindow(from: string, to: string): AnalyticsDateWindow {
  analyticsIsoDate(from); analyticsIsoDate(to);
  if (from > to) throw new Error("invalid_analytics_date_range");
  const length = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY + 1;
  return { from, to, dates: Array.from({ length }, (_, index) => analyticsAddDays(from, index)) };
}

function single(params: URLSearchParams, key: string): string | null {
  if (params.getAll(key).length > 1) throw new Error("duplicate_analytics_query");
  return params.get(key);
}

/** Resolve once using a server supplied clock; all sources must consume this same result. */
export function parseAnalyticsPeriod(params: URLSearchParams, now = new Date()): AnalyticsPeriod {
  for (const key of PERIOD_QUERY_KEYS) single(params, key);
  const today = analyticsKyivDate(now);
  if (today < ANALYTICS_HISTORY_START) throw new Error("analytics_history_not_started");
  const yesterday = analyticsAddDays(today, -1);
  const rawPeriod = single(params, "period");
  const legacy = single(params, "days");
  if (legacy !== null && (rawPeriod !== null || params.has("from") || params.has("to"))) {
    throw new Error("conflicting_analytics_period");
  }
  if (legacy !== null && !["7", "14", "30", "60"].includes(legacy)) throw new Error("invalid_analytics_period");
  const preset = rawPeriod ?? (legacy !== null ? `${legacy}d` : "7d");
  if (!ANALYTICS_PRESETS.includes(preset as AnalyticsPreset)) throw new Error("invalid_analytics_period");
  if (preset !== "custom" && (params.has("from") || params.has("to"))) throw new Error("conflicting_analytics_period");
  let from: string;
  let to = yesterday;
  if (preset === "custom") {
    from = single(params, "from") ?? "";
    to = single(params, "to") ?? "";
  } else if (preset === "today") {
    from = today; to = today;
  } else if (preset === "yesterday") {
    from = yesterday;
  } else if (/^\d+d$/.test(preset)) {
    from = analyticsAddDays(yesterday, -(Number(preset.slice(0, -1)) - 1));
  } else if (preset === "month") {
    from = `${today.slice(0, 7)}-01`;
  } else if (preset === "previous-month") {
    to = analyticsAddDays(`${today.slice(0, 7)}-01`, -1);
    from = `${to.slice(0, 7)}-01`;
  } else if (preset === "quarter") {
    const month = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
    from = `${today.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
  } else if (preset === "ytd") {
    from = `${today.slice(0, 4)}-01-01`;
  } else {
    from = ANALYTICS_HISTORY_START;
  }
  analyticsIsoDate(from); analyticsIsoDate(to);
  if (from > to) throw new Error(preset === "custom" ? "invalid_analytics_date_range" : "analytics_closed_period_empty");
  if (from < ANALYTICS_HISTORY_START) throw new Error("analytics_period_before_history");
  if (to > today) throw new Error("analytics_period_in_future");
  const requested = analyticsWindow(from, to);
  const provisionalDate = to === today ? today : null;
  const closed = from <= yesterday ? analyticsWindow(from, to === today ? yesterday : to) : null;
  const grain = single(params, "grain") ?? (requested.dates.length <= 31 ? "day" : requested.dates.length <= 120 ? "week" : "month");
  if (!["day", "week", "month"].includes(grain)) throw new Error("invalid_analytics_grain");
  const comparisonMode = single(params, "comparison") ?? "previous";
  if (!["previous", "custom", "off"].includes(comparisonMode)) throw new Error("invalid_analytics_comparison");
  if (comparisonMode !== "custom" && (params.has("compare_from") || params.has("compare_to"))) {
    throw new Error("conflicting_analytics_comparison");
  }
  let comparison: AnalyticsPeriod["comparison"];
  if (comparisonMode === "off") {
    comparison = { status: "disabled", window: null, reason: "disabled" };
  } else if (comparisonMode === "custom") {
    const compareFrom = analyticsIsoDate(single(params, "compare_from") ?? "");
    const compareTo = analyticsIsoDate(single(params, "compare_to") ?? "");
    if (compareFrom > compareTo) throw new Error("invalid_analytics_date_range");
    if (compareTo > yesterday) throw new Error("analytics_comparison_not_closed");
    // Unavailable history is metadata, not millions of requested dates to allocate/fetch.
    const window = compareFrom < ANALYTICS_HISTORY_START
      ? { from: compareFrom, to: compareTo, dates: [] }
      : analyticsWindow(compareFrom, compareTo);
    comparison = window.from < ANALYTICS_HISTORY_START
      ? { status: "unavailable", window, reason: "before_history_start" }
      : { status: "available", window, reason: null };
  } else if (!closed) {
    comparison = { status: "unavailable", window: null, reason: "no_closed_days" };
  } else {
    const previousTo = analyticsAddDays(closed.from, -1);
    const previousFrom = analyticsAddDays(previousTo, -(closed.dates.length - 1));
    const window = previousFrom < ANALYTICS_HISTORY_START
      ? { from: previousFrom, to: previousTo, dates: [] }
      : analyticsWindow(previousFrom, previousTo);
    comparison = window.from < ANALYTICS_HISTORY_START
      ? { status: "unavailable", window, reason: "before_history_start" }
      : { status: "available", window, reason: null };
  }
  return { preset: preset as AnalyticsPreset, timezone: ANALYTICS_TIMEZONE, historyStart: ANALYTICS_HISTORY_START,
    resolvedAt: now.toISOString(), requested, closed, provisionalDate, grain: grain as AnalyticsGrain,
    comparisonMode: comparisonMode as AnalyticsPeriod["comparisonMode"], comparison };
}

/** Preserve tab/category/product/method/scope; replace only period parameters. */
export function applyAnalyticsPeriodQuery(params: URLSearchParams, period: AnalyticsPeriod): URLSearchParams {
  const result = new URLSearchParams(params);
  for (const key of PERIOD_QUERY_KEYS) result.delete(key);
  result.set("period", period.preset);
  if (period.preset === "custom") {
    result.set("from", period.requested.from); result.set("to", period.requested.to);
  }
  result.set("grain", period.grain);
  result.set("comparison", period.comparisonMode);
  if (period.comparisonMode === "custom" && period.comparison.window) {
    result.set("compare_from", period.comparison.window.from); result.set("compare_to", period.comparison.window.to);
  }
  return result;
}
