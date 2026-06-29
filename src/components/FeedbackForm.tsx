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
  role: "seller" | "admin" | "super_admin";
  store_id: number | null;
}

interface MeResponse {
  user: SessionUser | null;
  store?: { id: number; name: string } | null;
}

export function FeedbackForm({ category }: Props) {
  const router = useRouter();
  const { initData, webApp } = useTelegram();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j: MeResponse) => {
        setMe(j?.user ?? null);
        setStoreName(j?.store?.name ?? null);
      })
      .catch(() => {})
      .finally(() => setMeReady(true));
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

  // Skeleton while we wait for /api/auth/me — avoids StoreSelect flicker
  if (!meReady) {
    return (
      <div className="card space-y-4 p-5">
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-13 w-full rounded-2xl" />
        <div className="skeleton h-4 w-24 rounded-full" />
        <div className="skeleton h-13 w-full rounded-2xl" />
        <div className="skeleton h-13 w-full rounded-2xl" />
      </div>
    );
  }

  const lockedStoreId = me?.role === "seller" ? me.store_id : null;

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      {/* Identity chip */}
      {me ? (
        <div className="flex items-center gap-2">
          <span className="pill bg-elev2 text-ink-700">
            Від: <span className="font-medium text-ink-900">{me.full_name}</span>
          </span>
          {me.role === "super_admin" ? (
            <span className="pill bg-brand-100 text-brand-700">супер-адмін</span>
          ) : me.role === "admin" ? (
            <span className="pill bg-brand-50 text-brand-600">адмін</span>
          ) : null}
        </div>
      ) : null}

      {/* Store: locked chip for sellers, search for admins */}
      {lockedStoreId ? (
        <>
          <input type="hidden" name="store_id" value={lockedStoreId} />
          {storeName ? (
            <div>
              <label className="field-label">Магазин</label>
              <span className="pill bg-cat-missing/40 text-ink-900">
                <span aria-hidden>📍</span>
                {storeName}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <StoreSelect />
      )}

      {/* Dev notice banner */}
      {(category.id === "tech_issue" || category.id === "consumables_request") && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-50/50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="flex gap-3">
            <span className="text-xl" aria-hidden>
              {category.id === "tech_issue" ? "🔧" : "📋"}
            </span>
            <div className="space-y-1">
              <h4 className="text-[14px] font-semibold text-amber-900 leading-none">
                Розділ у розробці (Демо-режим)
              </h4>
              <p className="mt-1 text-[12px] text-amber-700 leading-normal">
                {category.id === "tech_issue"
                  ? "Ця форма працює в тестовому режимі. Незабаром вона буде автоматично інтегрована з модулем технічної служби для миттєвого створення заявок."
                  : "Ця заявка працює в режимі демо. Вона буде автоматично синхронізуватись зі складським модулем CRM для відвантаження товарів."}
              </p>
            </div>
          </div>
        </div>
      )}

      {category.fields.map((f) => {
        if (f.kind === "photo") {
          return <PhotoInput key={f.id} label={f.label} onChange={setPhoto} />;
        }
        if (f.kind === "textarea") {
          return (
            <div key={f.id}>
              <label htmlFor={f.id} className="field-label">
                {f.label}
                {f.required ? <span className="text-brand-500"> *</span> : null}
              </label>
              <textarea
                id={f.id}
                name={f.id}
                placeholder={f.placeholder}
                required={f.required}
                className="field-textarea"
              />
              {f.hint ? (
                <p className="mt-1 text-[12px] text-ink-500">{f.hint}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={f.id}>
            <label htmlFor={f.id} className="field-label">
              {f.label}
              {f.required ? <span className="text-brand-500"> *</span> : null}
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
        <div className="rounded-2xl border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
          {error}
        </div>
      ) : null}

      {/* Sticky CTA bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-ghost px-4"
          >
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
