import { NextResponse } from "next/server";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function fail(error: string, status: number, code = error) {
  return NextResponse.json({ error, code }, { status });
}

export function isSchemaMissing(code?: string) {
  return code === "42P01" || code === "42703" || code === "42883";
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function boundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= 3 && text.length <= 500 ? text : null;
}

export function actionError(code?: string, message?: string) {
  if (isSchemaMissing(code)) return fail("Міграція HR-заявок ще не застосована", 503, "absence_request_schema_missing");
  if (code === "23P01") return fail("У продавця вже є активна відсутність у цьому періоді", 422, "absence_overlap");
  if (code !== "P0001") return fail("Не вдалося обробити HR-заявку", 500, "absence_request_action_error");

  const safe = message ?? "";
  if (safe.includes("not_found")) return fail("HR-заявку не знайдено", 404, "absence_request_not_found");
  if (safe.includes("not_actionable") || safe.includes("already_approved")) {
    return fail("HR-заявку вже обробив інший адміністратор", 409, "absence_request_not_actionable");
  }
  if (safe.includes("employee_not_active_seller")) {
    return fail("Продавець більше не активний", 422, "absence_request_employee_inactive");
  }
  if (safe.includes("invalid") || safe.includes("store_snapshot_missing")) {
    return fail("У HR-заявці некоректні дані для погодження", 422, "absence_request_invalid");
  }
  return fail("HR-заявку не можна обробити", 422, "absence_request_rejected");
}
