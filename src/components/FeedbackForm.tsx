"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Category } from "@/lib/categories";
import { useTelegram } from "./TelegramProvider";
import { PhotoInput } from "./PhotoInput";
import { StoreSelect } from "./StoreSelect";

interface Props {
  category: Category;
}

export function FeedbackForm({ category }: Props) {
  const router = useRouter();
  const { initData, webApp, user } = useTelegram();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const fields: Record<string, string | number | null> = {};
    for (const f of category.fields) {
      if (f.kind === "photo") continue;
      const raw = (data.get(f.id) as string | null)?.trim() ?? "";
      if (f.required && !raw) {
        setError(`Заповни поле: ${f.label}`);
        setSubmitting(false);
        webApp?.HapticFeedback?.notificationOccurred("error");
        return;
      }
      fields[f.id] =
        f.kind === "number" && raw ? Number(raw) : raw === "" ? null : raw;
    }

    const payload = {
      category: category.id,
      store: (data.get("store") as string | null) || undefined,
      fields,
      photo_url: photo,
      init_data: initData || undefined,
    };

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      webApp?.HapticFeedback?.notificationOccurred("success");
      router.push(`/thanks?cat=${category.id}`);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Не вдалось відправити. Спробуй ще раз.",
      );
      webApp?.HapticFeedback?.notificationOccurred("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-5 p-5">
      <StoreSelect />

      {category.fields.map((f) => {
        if (f.kind === "photo") {
          return (
            <PhotoInput key={f.id} label={f.label} onChange={setPhoto} />
          );
        }
        if (f.kind === "textarea") {
          return (
            <div key={f.id}>
              <label htmlFor={f.id} className="field-label">
                {f.label}
                {f.required ? <span className="text-blush-500"> *</span> : null}
              </label>
              <textarea
                id={f.id}
                name={f.id}
                placeholder={f.placeholder}
                required={f.required}
                className="field-textarea"
              />
              {f.hint ? (
                <p className="mt-1 text-xs text-ink-500">{f.hint}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={f.id}>
            <label htmlFor={f.id} className="field-label">
              {f.label}
              {f.required ? <span className="text-blush-500"> *</span> : null}
            </label>
            <input
              id={f.id}
              name={f.id}
              type={f.kind === "number" ? "number" : "text"}
              inputMode={f.kind === "number" ? "numeric" : undefined}
              placeholder={f.placeholder}
              required={f.required}
              className="field-input"
            />
          </div>
        );
      })}

      {error ? (
        <div className="rounded-2xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-600">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="btn-ghost"
        >
          Назад
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Відправляю..." : "Відправити 💌"}
        </button>
      </div>

      {!user ? (
        <p className="pt-1 text-center text-[11px] text-ink-500">
          Запущено поза Telegram — фідбек збережеться без імені.
        </p>
      ) : null}
    </form>
  );
}
