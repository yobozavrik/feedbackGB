"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitHrRequest } from "@/lib/hrClient";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function SickLeaveForm() {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) return setError("Фото завелике (макс. 5 МБ)");
    const reader = new FileReader();
    reader.onload = () => setPhoto(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dateFrom) return setError("Вкажи дату початку");
    if (dateTo && dateTo < dateFrom) return setError("Дата закінчення не може бути раніше початку");
    setBusy(true);
    try {
      await submitHrRequest(
        { hr_topic: "sick-leave", date_from: dateFrom, date_to: dateTo || null, comment: comment.trim() || null },
        photo,
      );
      router.push("/home/thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      <div>
        <label htmlFor="date_from" className="field-label">Перший день <span className="text-brand-500">*</span></label>
        <input id="date_from" type="date" required value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)} className="field-input" />
      </div>
      <div>
        <label htmlFor="date_to" className="field-label">Орієнтовний останній день</label>
        <input id="date_to" type="date" min={dateFrom} value={dateTo}
          onChange={(e) => setDateTo(e.target.value)} className="field-input" />
      </div>
      <div>
        <label htmlFor="photo" className="field-label">Фото довідки / лікарняного</label>
        <input id="photo" type="file" accept="image/*" onChange={onPhoto}
          className="block w-full text-[13px] text-ink-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-500" />
        {photo ? <p className="mt-1 text-[12px] text-brand-600">Фото додано ✓</p> : null}
      </div>
      <div>
        <label htmlFor="comment" className="field-label">Коментар</label>
        <textarea id="comment" placeholder="Деталі (необов'язково)" value={comment}
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
