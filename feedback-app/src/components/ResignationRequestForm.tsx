"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTelegram } from "./TelegramProvider";

const NOTICE_DAYS = 14;

interface SessionUser {
  uid: string;
  full_name: string;
  role: "seller" | "admin" | "super_admin";
  store_id: number | null;
}

interface MeResponse {
  user: SessionUser | null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.round((target - todayUtc) / 86_400_000);
}

export function ResignationRequestForm() {
  const router = useRouter();
  const { initData, webApp } = useTelegram();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [date, setDate] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineSaved, setOfflineSaved] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j: MeResponse) => setMe(j?.user ?? null))
      .catch(() => {})
      .finally(() => setMeReady(true));
  }, []);

  const shortNotice = date !== "" && daysUntil(date) < NOTICE_DAYS;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!date) {
      setError("Вкажи бажану дату звільнення");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    if (daysUntil(date) < 0) {
      setError("Дата звільнення не може бути в минулому");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }

    setSubmitting(true);

    const clientSubmissionId = window.crypto.randomUUID();
    const clientCreatedAt = new Date().toISOString();
    const payload = {
      category: "hr_question" as const,
      store_id: me?.store_id ?? null,
      fields: {
        hr_topic: "resignation",
        date_from: date,
        date_to: null,
        comment: comment.trim() || null,
      },
      init_data: initData || undefined,
      client_submission_id: clientSubmissionId,
      client_created_at: clientCreatedAt,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      webApp?.HapticFeedback?.notificationOccurred("success");
      router.push("/thanks?cat=hr_question");
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);

      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error &&
          (err.message.includes("fetch") ||
            err.message.includes("Network") ||
            err.message.includes("aborted")));

      if (isNetworkError && me) {
        try {
          const { saveOfflineSubmission } = await import("@/lib/offlineDb");
          await saveOfflineSubmission({
            id: clientSubmissionId,
            client_submission_id: clientSubmissionId,
            submitter_uid: me.uid,
            submitter_store_id: me.store_id,
            submitter_name: me.full_name,
            payload,
            client_created_at: clientCreatedAt,
            status: "pending",
            attempts: 0,
          });
          webApp?.HapticFeedback?.notificationOccurred("warning");
          setOfflineSaved(true);
        } catch (saveErr) {
          console.error("Failed to save offline submission:", saveErr);
          setError(
            saveErr instanceof Error
              ? saveErr.message
              : "Помилка при збереженні офлайн-заявки",
          );
          webApp?.HapticFeedback?.notificationOccurred("error");
        }
      } else {
        setError(
          err instanceof Error ? err.message : "Не вдалось відправити. Спробуй ще раз.",
        );
        webApp?.HapticFeedback?.notificationOccurred("error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (offlineSaved) {
    return (
      <div className="card animate-fade-up space-y-6 p-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-[32px] text-amber-500 shadow-soft">
          💾
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-[20px] font-bold leading-snug text-ink-900">
            Збережено офлайн
          </h2>
          <p className="text-[14px] leading-relaxed text-ink-700">
            Наразі немає зв&apos;язку. Заявку збережено в пам&apos;яті пристрою.
          </p>
          <p className="text-[13px] font-medium text-brand-600">
            Вона буде надіслана автоматично, коли з&apos;явиться інтернет і додаток буде відкритим.
          </p>
        </div>
        <button type="button" onClick={() => router.push("/")} className="btn-primary w-full">
          На головну
        </button>
      </div>
    );
  }

  if (!meReady) {
    return (
      <div className="card space-y-4 p-5">
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-13 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      {me ? (
        <div className="flex items-center gap-2">
          <span className="pill bg-elev2 text-ink-700">
            Від: <span className="font-medium text-ink-900">{me.full_name}</span>
          </span>
        </div>
      ) : null}

      <div>
        <label htmlFor="date" className="field-label">
          Бажана дата звільнення <span className="text-brand-500">*</span>
        </label>
        <input
          id="date"
          name="date"
          type="date"
          min={todayStr()}
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="field-input"
        />
      </div>

      {shortNotice ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-50/50 p-4 backdrop-blur-sm">
          <div className="flex gap-3">
            <span className="text-xl" aria-hidden>
              ℹ️
            </span>
            <p className="text-[12px] leading-normal text-amber-700">
              За законодавством зазвичай потрібно попередити про звільнення за{" "}
              {NOTICE_DAYS} днів. До обраної дати залишилось менше — це не заблокує заявку,
              але адміністрація може зв&apos;язатись, щоб узгодити дату.
            </p>
          </div>
        </div>
      ) : null}

      <div>
        <label htmlFor="comment" className="field-label">
          Коментар
        </label>
        <textarea
          id="comment"
          name="comment"
          placeholder="Причина (необов'язково)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="field-textarea"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
          {error}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost px-4">
            Назад
          </button>
          <button type="submit" disabled={submitting} className="btn-primary flex-1">
            {submitting ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <>Відправити <span aria-hidden>💌</span></>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
