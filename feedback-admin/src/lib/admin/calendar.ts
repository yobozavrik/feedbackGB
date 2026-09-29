export const CALENDAR_COLUMNS = "id,title,description,due_at,remind_at,status,reminder_seen_at,row_version";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CalendarTask {
  id: string; title: string; description: string; due_at: string;
  remind_at: string | null; status: "planned" | "done";
  reminder_seen_at: string | null; row_version: number;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const datePart = value.slice(0, 10);
  const calendarDay = new Date(`${datePart}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== datePart ||
      Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function calendarRange(from: string | null, to: string | null) {
  const start = timestamp(from); const end = timestamp(to);
  if (!start || !end || start >= end || Date.parse(end) - Date.parse(start) > 62 * 86400000) return null;
  return { start, end };
}
export function calendarInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const allowed = new Set(["id", "row_version", "title", "description", "due_at", "remind_at", "status"]);
  if (Object.keys(b).some(key => !allowed.has(key))) return null;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const due = timestamp(b.due_at);
  const remind = b.remind_at == null ? null : timestamp(b.remind_at);
  if (!title || title.length > 200 || description.length > 2000 || !due ||
    (b.description != null && typeof b.description !== "string") ||
    (b.remind_at != null && (!remind || remind > due)) ||
    (b.status !== "planned" && b.status !== "done")) return null;
  return { title, description, due_at: due, remind_at: remind, status: b.status as "planned" | "done" };
}
