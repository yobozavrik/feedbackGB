"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitHrRequest } from "@/lib/hrClient";

export function ResignationForm() {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dateFrom) return setError("Вкажи бажану дату звільнення");
    setBusy(true);
    try {
      await submitHrRequest({ hr_topic: "resignation", date_from: dateFrom, comment: comment.trim() || null });
      router.push("/home/thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      <div className="rounded-lg border border-brand-500/20 bg-brand-50/50 p-3 text-[12px] leading-normal text-ink-700">
        За законом про звільнення попереджають щонайменше за 2 тижні. Менеджер зв&apos;яжеться для деталей.
      </div>
      <div>
        <label htmlFor="date_from" className="field-label">Бажана дата звільнення <span className="text-brand-500">*</span></label>
        <input id="date_from" type="date" min={today} required value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)} className="field-input" />
      </div>
      <div>
        <label htmlFor="comment" className="field-label">Коментар</label>
        <textarea id="comment" placeholder="Причина / деталі (необов'язково)" value={comment}
          onChange={(e) => setComment(e.target.value)} className="field-textarea" />
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">{error}</div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost px-4">Назад</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? "Відправляємо…" : "Відправити"}
          </button>
        </div>
      </div>
    </form>
  );
}
