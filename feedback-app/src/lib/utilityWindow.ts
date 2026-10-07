export type UtilityWindow = {
  status: string;
  period_start: string;
  due_at: string;
};

const kyivCalendar = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
});

/** The first window is the 28th through month end in Kyiv; prior versions use a separate rule. */
export function utilityInitialWindowState(
  period: UtilityWindow,
  nowMs: number = Date.now(),
): "upcoming" | "open" | "closed" {
  if (period.status !== "open" || !Number.isFinite(nowMs)
    || !/^\d{4}-\d{2}-01$/.test(period.period_start)) return "closed";
  const due = Date.parse(period.due_at);
  if (!Number.isFinite(due)) return "closed";
  const parts = kyivCalendar.formatToParts(new Date(nowMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (`${year}-${month}` !== period.period_start.slice(0, 7)) return "closed";
  if (Number(day) < 28) return "upcoming";
  return nowMs <= due ? "open" : "closed";
}
