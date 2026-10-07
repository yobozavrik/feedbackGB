import { checkCronAuth } from "@/lib/cronAuth";
import { getServerSupabase } from "@/lib/supabase";
import { TelegramError, telegramAlbum } from "@/lib/admin/utilityTelegram";
import { utilityTrace } from "@/lib/admin/utilityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const categoryLabel: Record<string, string> = {
  electricity: "Електроенергія", water: "Вода", heating: "Опалення", other: "Інші послуги",
};
const knownDeliveryErrors = new Set([
  "submission_missing", "packet_query_failed", "photo_missing", "telegram_text_too_long",
  "delivery_ledger_write_failed", "upload_missing", "photo_download_failed",
]);

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function telegram(method: string, token: string, body: Record<string, unknown> | FormData): Promise<number> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", body: body instanceof FormData ? body : JSON.stringify(body),
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json() as { ok?: boolean; error_code?: number;
    parameters?: { retry_after?: number }; result?: { message_id?: number } };
  if (!response.ok || !result.ok || typeof result.result?.message_id !== "number") {
    throw new TelegramError(`telegram_${result.error_code ?? response.status}`, result.parameters?.retry_after ?? null);
  }
  return result.result.message_id;
}

/** This route is deployed only in feedback-admin, so there is one dispatcher. */
export async function GET(req: Request) {
  const trace = utilityTrace(req, "GET /api/cron/utility-dispatch");
  const auth = checkCronAuth(req);
  if (!auth.ok) return trace.fail(auth.error, auth.status, "utility.access.denied", "warn");
  if (process.env.UTILITY_READINGS_ENABLED !== "true") return trace.json({ ok: true, skipped: true, reason: "feature_disabled" });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_UTILITY_CHAT_ID;
  if (!token || !chatId) return trace.fail("utility_telegram_not_configured", 503, "utility.delivery.config_failed", "error");
  const db = getServerSupabase();
  if (!db) return trace.fail("backend_unavailable", 503, "utility.access.backend_failed", "error");
  const { data: jobId, error: claimError } = await db.rpc("claim_utility_delivery_job", { p_chat_id: chatId });
  if (claimError) return trace.fail("claim_failed", 500, "utility.delivery.claim_failed", "error");
  if (!jobId) return trace.json({ ok: true, processed: 0 });
  const { data: job, error: jobError } = await db.from("utility_delivery_jobs").select("id,submission_id,message_ids,chat_id_snapshot")
    .eq("id", jobId).single();
  if (jobError || !job) return trace.fail("claimed_job_missing", 500, "utility.delivery.job_read_failed", "critical", { job_id: jobId });
  const ids: number[] = Array.isArray(job.message_ids) ? job.message_ids.filter((id: unknown) => typeof id === "number") : [];
  let outcome: "sent" | "retryable_failed" | "permanent_failed" | "uncertain" = "uncertain";
  let errorCode: string | null = null;
  let retryAfter: number | null = null;
  try {
    const { data: submission, error: submissionError } = await db.from("utility_submissions")
      .select("id,store_id,period_id,category,comment,submitted_by,revision,submitted_at,review_status")
      .eq("id", job.submission_id).single();
    if (submissionError || !submission) throw new Error("submission_missing");
    const [storeResult, periodResult, userResult, photosResult] = await Promise.all([
      db.from("v_stores").select("name").eq("id", submission.store_id).maybeSingle(),
      db.from("utility_periods").select("period_start,period_end").eq("id", submission.period_id).single(),
      db.from("users").select("full_name").eq("id", submission.submitted_by).single(),
      db.from("utility_photos").select("id,upload_id,sort_order")
        .eq("submission_id", submission.id).order("sort_order"),
    ]);
    if (storeResult.error || periodResult.error || userResult.error || photosResult.error || !periodResult.data) {
      throw new Error("packet_query_failed");
    }
    const photos = photosResult.data ?? [];
    if (photos.length < 1) throw new Error("photo_missing");
    const title = submission.revision > 1 ? "ВИПРАВЛЕННЯ ФОТО ПОСЛУГИ" : "ФОТО КОМУНАЛЬНОЇ ПОСЛУГИ";
    const lines = [
      `<b>${title}</b>`,
      `Магазин: <b>${escapeHtml(storeResult.data?.name ?? submission.store_id)}</b>`,
      `Послуга: <b>${escapeHtml(categoryLabel[submission.category] ?? submission.category)}</b>`,
      `Період: ${escapeHtml(periodResult.data.period_start)} — ${escapeHtml(periodResult.data.period_end)}`,
      `Автор: ${escapeHtml(userResult.data?.full_name ?? "невідомо")}`,
      `Версія: ${submission.revision} · № ${escapeHtml(submission.id)}`,
      `Фото: ${photos.length}`,
      `Стан: подано, ще не перевірено бухгалтером`,
      submission.comment ? `Коментар: ${escapeHtml(submission.comment)}` : "",
    ];
    const message = lines.join("\n");
    if (message.length > 4000) throw new Error("telegram_text_too_long");
    const messageId = await telegram("sendMessage", token, { chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true });
    ids.push(messageId);
    const { error: firstLedgerError } = await db.from("utility_delivery_jobs").update({ message_ids: ids }).eq("id", job.id);
    if (firstLedgerError) throw new Error("delivery_ledger_write_failed");
    for (let start = 0; start < photos.length; start += 10) {
      const batch = photos.slice(start, start + 10);
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("reply_parameters", JSON.stringify({ message_id: messageId }));
      const media: Array<{ type: "photo"; media: string; caption?: string }> = [];
      const attachments: Array<{ blob: Blob; filename: string }> = [];
      for (const [index, photo] of batch.entries()) {
        const { data: upload, error: uploadError } = await db.from("utility_uploads")
          .select("storage_path,mime").eq("id", photo.upload_id).single();
        if (uploadError || !upload) throw new Error("upload_missing");
        const { data: blob, error: downloadError } = await db.storage.from("utility-reading-photos").download(upload.storage_path);
        if (downloadError || !blob) throw new Error("photo_download_failed");
        const extension = upload.mime === "image/png" ? "png" : upload.mime === "image/webp" ? "webp" : "jpg";
        const attachment = `photo${index}`;
        const filename = `utility-${photo.id}.${extension}`;
        attachments.push({ blob, filename });
        if (batch.length > 1) form.set(attachment, blob, filename);
        media.push({ type: "photo", media: `attach://${attachment}`,
          ...(index === 0 ? { caption: `${categoryLabel[submission.category] ?? submission.category} · фото ${start + 1}–${start + batch.length}/${photos.length}` } : {}),
        });
      }
      if (batch.length === 1) {
        form.set("photo", attachments[0].blob, attachments[0].filename);
        form.set("caption", media[0].caption ?? "Фото послуги");
        ids.push(await telegram("sendPhoto", token, form));
      } else {
        form.set("media", JSON.stringify(media));
        ids.push(...await telegramAlbum(token, form, batch.length));
      }
      const { error: ledgerError } = await db.from("utility_delivery_jobs").update({ message_ids: ids }).eq("id", job.id);
      if (ledgerError) throw new Error("delivery_ledger_write_failed");
    }
    outcome = "sent";
  } catch (error) {
    errorCode = error instanceof TelegramError && /^telegram_\d{3}$/.test(error.code)
      ? error.code : error instanceof Error && knownDeliveryErrors.has(error.message)
        ? error.message : "unknown_delivery_error";
    retryAfter = error instanceof TelegramError ? error.retryAfter : null;
    outcome = ids.length > 0 ? "uncertain" : error instanceof TelegramError
      ? error.code === "telegram_429" || error.code.startsWith("telegram_5") ? "retryable_failed" : "permanent_failed"
      : "uncertain";
    const event = errorCode === "delivery_ledger_write_failed" ? "utility.delivery.ledger_failed"
      : error instanceof TelegramError ? "utility.delivery.telegram_failed" : "utility.delivery.packet_failed";
    trace.log(event, outcome === "uncertain" ? "critical" : "error",
      { job_id: job.id, submission_id: job.submission_id, error_code: errorCode, message_count: ids.length });
    if (outcome === "uncertain") trace.log("utility.delivery.uncertain", "critical",
      { job_id: job.id, submission_id: job.submission_id, error_code: "uncertain_delivery", message_count: ids.length });
  }
  const { error: updateError } = await db.from("utility_delivery_jobs").update({
    state: outcome, message_ids: ids, last_error_code: errorCode, locked_until: null,
    next_attempt_at: outcome === "retryable_failed" ? new Date(Date.now() + (retryAfter ?? 60) * 1000).toISOString() : new Date().toISOString(),
    sent_at: outcome === "sent" ? new Date().toISOString() : null,
  }).eq("id", job.id);
  if (updateError) {
    trace.log("utility.delivery.state_write_failed", "critical",
      { job_id: job.id, submission_id: job.submission_id, error_code: "delivery_state_write_failed", message_count: ids.length });
    return trace.json({ error: "delivery_state_write_failed", job_id: job.id }, 500);
  }
  return trace.json({ ok: outcome === "sent", processed: 1, job_id: job.id, state: outcome,
    message_count: ids.length, error: errorCode });
}
