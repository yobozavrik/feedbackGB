"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Category } from "@/lib/categories";
import { useTelegram } from "./TelegramProvider";
import { PhotoInput } from "./PhotoInput";
import { StoreSelect } from "./StoreSelect";

interface Props {
  category: Category;
}

interface SessionUser {
  full_name: string;
  role: "seller" | "admin";
  store_id: number | null;
}

export function FeedbackForm({ category }: Props) {
  const router = useRouter();
  const { initData, webApp } = useTelegram();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [me, setMe] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setMe(j?.user ?? null))
      .catch(() => {});
  }, []);

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

    const storeIdRaw = (data.get("store_id") as string | null) ?? "";
    const storeLabelRaw = (data.get("store_label") as string | null) ?? "";
    const payload = {
      category: category.id,
      store_id: storeIdRaw ? Number(storeIdRaw) : null,
      store_label: storeLabelRaw || null,
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

  // If user is a seller bound to a specific store, lock store selection.
  const lockedStoreId = me?.role === "seller" ? me.store_id : null;

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-5 p-5">
      {me ? (
        <div className="text-xs text-ink-500">
          Від: <span className="font-medium text-ink-900">{me.full_name}</span>
          {me.role === "admin" ? " (адмін)" : ""}
        </div>
      ) : null}

      {lockedStoreId ? (
        <input type="hidden" name="store_id" value={lockedStoreId} />
      ) : (
        <StoreSelect />
      )}

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
    </form>
  );
}
