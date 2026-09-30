import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncPosterReceiptsNightly } from "@/lib/admin/posterReceiptNightlyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const CONFIG_ERRORS = new Set([
  "receipt_schema_missing",
  "receipt_service_config_missing",
  "receipt_account_config_missing",
  "receipt_token_missing",
  "receipt_publishing_disabled",
]);

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: true, skipped: true, reason: "non_production_environment" });
  }
  if (!process.env.CRON_SECRET) {
    return json({ error: "cron_secret_not_configured" }, 503);
  }
  const auth = checkCronAuth(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    const result = await syncPosterReceiptsNightly(new Date(), request.signal);
    console.info(JSON.stringify({ event: "poster_receipt_cron", ...result }));
    return json({ ok: true, ...result });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "receipt_cron_failed";
    const code = /^receipt_[a-z_]{1,72}$/.test(raw) ? raw : "receipt_cron_failed";
    console.error(JSON.stringify({ event: "poster_receipt_cron", status: "failed", code }));
    if (CONFIG_ERRORS.has(code)) return json({ ok: false, error: code }, 503);
    return json({ ok: false, error: "receipt_cron_failed" }, 500);
  }
}
