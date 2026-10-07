import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

type Level = "info" | "warn" | "error" | "critical";
type Fields = {
  phase?: string; error_code?: string; http_status?: number; store_id?: number;
  period_id?: string; category?: string; client_submission_id?: string;
  submission_id?: string; upload_id?: string; job_id?: string;
  photo_count?: number; message_count?: number; duration_ms?: number;
};
const allowedFields = new Set([
  "phase", "error_code", "http_status", "store_id", "period_id", "category",
  "client_submission_id", "submission_id", "upload_id", "job_id", "photo_count",
  "message_count", "duration_ms",
]);

export function utilityTrace(req: Request, route: string) {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming)
    ? incoming : randomUUID();
  const started = Date.now();
  function log(event: string, level: Level, fields: Fields = {}) {
    const safeFields = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
      allowedFields.has(key) && (typeof value === "string" || typeof value === "number")));
    const record = { event, level, request_id: requestId, route,
      ...safeFields, duration_ms: Date.now() - started };
    const line = JSON.stringify(record);
    if (level === "info") console.info(line);
    else if (level === "warn") console.warn(line);
    else console.error(line);
  }
  function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, { status, headers: { "x-request-id": requestId } });
  }
  function fail(code: string, status: number, event: string, level: Level, fields: Fields = {}) {
    log(event, level, { ...fields, error_code: code, http_status: status });
    return json({ error: code }, status);
  }
  return { requestId, log, json, fail };
}
