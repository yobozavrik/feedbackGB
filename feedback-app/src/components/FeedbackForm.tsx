"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Category } from "@/lib/categories";
import { PHOTO_REPORT_MAX_PHOTOS, PHOTO_REPORT_MIN_PHOTOS } from "@/lib/feedbackValidation";
import { useTelegram } from "./TelegramProvider";
import { PhotoInput } from "./PhotoInput";
import { StoreSelect } from "./StoreSelect";
import { AlertTriangleIcon, CloudUploadIcon, InfoIcon, MapPinIcon } from "@/components/icons";

interface Props {
  category: Category;
}

interface SessionUser {
  uid: string;
  full_name: string;
  role: "seller" | "admin" | "super_admin";
  store_id: number | null;
}

interface MeResponse {
  user: SessionUser | null;
  store?: { id: number; name: string } | null;
}

interface PhotoReportStore {
  id: number;
  name: string;
}

interface PhotoReportStoresResponse {
  home_store: PhotoReportStore | null;
  replacement_stores: PhotoReportStore[];
}

export function FeedbackForm({ category }: Props) {
  const router = useRouter();
  const { initData, webApp } = useTelegram();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [homePhotoReportStore, setHomePhotoReportStore] = useState<PhotoReportStore | null>(null);
  const [replacementPhotoReportStores, setReplacementPhotoReportStores] = useState<PhotoReportStore[]>([]);
  const [selectedReplacementStoreId, setSelectedReplacementStoreId] = useState<number | null>(null);
  const [photoReportStoresReady, setPhotoReportStoresReady] = useState(false);
  const isPhotoReport = category.id === "photo_report";
  const missingPhotoReportPhotos = Math.max(0, PHOTO_REPORT_MIN_PHOTOS - photos.length);
  const hasEnoughPhotoReportPhotos = !isPhotoReport || missingPhotoReportPhotos === 0;

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

  useEffect(() => {
    if (category.id !== "photo_report") return;
    setPhotoReportStoresReady(false);
    setSelectedReplacementStoreId(null);
    fetch("/api/auth/photo-report-stores")
      .then((response) => response.ok ? response.json() : { home_store: null, replacement_stores: [] })
      .then((data: Partial<PhotoReportStoresResponse>) => {
        setHomePhotoReportStore(data.home_store ?? null);
        setReplacementPhotoReportStores(data.replacement_stores ?? []);
      })
      .catch(() => {
        setHomePhotoReportStore(null);
        setReplacementPhotoReportStores([]);
      })
      .finally(() => setPhotoReportStoresReady(true));
  }, [category.id]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (category.id === "photo_report" && !currentPhotoReportStore) {
      setError("Оберіть магазин, де працюєте зараз");
      setSubmitting(false);
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }

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

    const clientSubmissionId = window.crypto.randomUUID();
    const clientCreatedAt = new Date().toISOString();

    if (isPhotoReport && !hasEnoughPhotoReportPhotos) {
      setError(`Додайте ще ${missingPhotoReportPhotos} фото. Мінімум — ${PHOTO_REPORT_MIN_PHOTOS}.`);
      setSubmitting(false);
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }

    const payload = {
      category: category.id,
      store_id: storeIdRaw ? Number(storeIdRaw) : null,
      store_label: storeLabelRaw || null,
      fields,
      photo_url: photos[0] ?? null,
      photo_urls: photos,
      init_data: initData || undefined,
      client_submission_id: clientSubmissionId,
      client_created_at: clientCreatedAt,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout

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
      router.push(`/thanks?cat=${category.id}`);
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);

      // Check if it's a network error (TypeErrors like failed to fetch, or abort)
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && (err.message.includes("fetch") || err.message.includes("Network") || err.message.includes("aborted")));

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
            saveErr instanceof Error ? saveErr.message : "Помилка при збереженні офлайн-заявки",
          );
          webApp?.HapticFeedback?.notificationOccurred("error");
        }
      } else {
        setError(
          err instanceof Error ? err.message : "Не вдалося відправити. Спробуй ще раз.",
        );
        webApp?.HapticFeedback?.notificationOccurred("error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Local offline success UI state
  if (offlineSaved) {
    return (
      <div className="card animate-fade-up space-y-6 p-6 text-center">
        {/* A6: same warning-toned cloud icon on every "saved offline" screen
            (FeedbackForm/PriorityFeedbackForm/HrDateRangeRequestForm). */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft text-warning shadow-soft">
          <CloudUploadIcon size={30} />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-[20px] font-bold text-ink-900 leading-snug">
            Збережено офлайн
          </h2>
          <p className="text-[14px] leading-relaxed text-ink-700">
            Зараз немає інтернету. Заявку збережено на телефоні.
          </p>
          <p className="text-[13px] text-ink-500">
            Надішлемо самі, щойно з&apos;явиться зв&apos;язок — тримай додаток відкритим.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="btn-primary w-full"
        >
          На головну
        </button>
      </div>
    );
  }

  // Skeleton while we wait for /api/auth/me — avoids StoreSelect flicker
  if (!meReady) {
    return (
      <div className="card space-y-4 p-5">
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-13 w-full rounded-app" />
        <div className="skeleton h-4 w-24 rounded-full" />
        <div className="skeleton h-13 w-full rounded-app" />
        <div className="skeleton h-13 w-full rounded-app" />
      </div>
    );
  }

  const isSellerPhotoReport = me?.role === "seller" && category.id === "photo_report";
  const selectedReplacementStore = replacementPhotoReportStores.find((store) => store.id === selectedReplacementStoreId) ?? null;
  const currentPhotoReportStore = selectedReplacementStore ?? homePhotoReportStore;

  if (isSellerPhotoReport && !photoReportStoresReady) {
    return (
      <div className="card space-y-4 p-5">
        <div className="skeleton h-4 w-40 rounded-full" />
        <div className="skeleton h-28 w-full rounded-2xl" />
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-13 w-full rounded-app" />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      {/* Identity chip */}
      {me ? (
        <div className="flex items-center gap-2">
          <span className="pill bg-elev2 text-ink-700">
            Від: <span className="font-medium text-ink-900">{me.full_name}</span>
          </span>
          {me.role === "super_admin" ? (
            <span className="pill bg-brand-50 text-brand-500">супер-адмін</span>
          ) : me.role === "admin" ? (
            <span className="pill bg-brand-50 text-brand-600">адмін</span>
          ) : null}
        </div>
      ) : null}

      {/* Store: locked chip for sellers, search for admins */}
      {isSellerPhotoReport ? (
        <div className="space-y-4">
          {currentPhotoReportStore ? (
            <>
              <input type="hidden" name="store_id" value={currentPhotoReportStore.id} />
              <section className="rounded-2xl bg-brand-600 p-4 text-white shadow-soft" aria-live="polite">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-white/80">Зараз працюю в магазині</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-[24px] font-bold leading-tight">{currentPhotoReportStore.name}</h2>
                  {selectedReplacementStore ? <span className="pill bg-white/95 text-brand-600">Заміна</span> : null}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-white/90">
                  Фото звіт буде зараховано для {selectedReplacementStore ? `магазину ${currentPhotoReportStore.name}` : "цього магазину"}
                </p>
              </section>
            </>
          ) : (
            <section className="rounded-card bg-warning-soft p-4">
              <p className="text-label text-warning">Де працюю зараз</p>
              <h2 className="mt-1 font-display text-title text-ink-900">Оберіть магазин</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-900">Оберіть магазин для заміни, щоб надіслати фото звіт.</p>
            </section>
          )}

          {replacementPhotoReportStores.length > 0 ? (
            <section className="rounded-card border border-ink-300/20 bg-elev p-4">
              <label className="field-label" htmlFor="photo-report-replacement-store">{selectedReplacementStore ? "Працюю на заміні" : "Працюю на заміні?"}</label>
              <p className="mb-3 text-[13px] leading-relaxed text-ink-500">Обери магазин, якщо сьогодні ти на заміні</p>
              <select
                id="photo-report-replacement-store"
                className="field-input field-select"
                value={selectedReplacementStoreId ?? ""}
                onChange={(event) => setSelectedReplacementStoreId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Обрати магазин для заміни</option>
                {replacementPhotoReportStores.map((store) => <option key={store.id} value={store.id}>{store.name} — заміна</option>)}
              </select>
              {selectedReplacementStore && homePhotoReportStore ? (
                <button type="button" onClick={() => setSelectedReplacementStoreId(null)} className="link mt-3">
                  Повернутися до основного магазину
                </button>
              ) : null}
            </section>
          ) : currentPhotoReportStore ? null : (
            <div className="callout callout-warning">
              <AlertTriangleIcon size={18} className="callout-icon" />
              Для вас не призначено магазин для фото звіту. Зверніться до адміністратора.
            </div>
          )}
        </div>
      ) : me?.role === "seller" && me.store_id ? (
        <>
          <input type="hidden" name="store_id" value={me.store_id} />
          {storeName ? (
            <div>
              <label className="field-label">Магазин</label>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-elev2 px-3 py-1.5 text-[14px] font-medium text-ink-900">
                <MapPinIcon size={16} className="text-ink-500" />
                {storeName}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <StoreSelect />
      )}

      {/* A3: this is information, not a warning — it says what happens to
          the request, so it gets the info tone, not amber. */}
      {(category.id === "tech_issue" || category.id === "consumables_request") && (
        <div className="callout callout-info animate-fade-up">
          <InfoIcon size={18} className="callout-icon" />
          <div>
            <h4 className="callout-title">Тестовий режим</h4>
            <p>
              {category.id === "tech_issue"
                ? "Заявка надійде адміністратору, але поки не потрапить у систему техслужби."
                : "Заявка надійде адміністратору, але поки не потрапить у складську систему."}
            </p>
          </div>
        </div>
      )}

      {category.fields.map((f) => {
        if (f.kind === "photo") {
          return (
            <PhotoInput
              key={f.id}
              label={f.label}
              maxPhotos={isPhotoReport ? PHOTO_REPORT_MAX_PHOTOS : undefined}
              maxOutputBytes={isPhotoReport ? 280 * 1024 : undefined}
              maxDimension={isPhotoReport ? 1280 : undefined}
              onChange={setPhotos}
            />
          );
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

      {isPhotoReport ? (
        <p className={hasEnoughPhotoReportPhotos ? "text-meta text-success" : "text-meta text-warning"} aria-live="polite">
          {hasEnoughPhotoReportPhotos
            ? `Мінімум виконано: ${photos.length}/${PHOTO_REPORT_MAX_PHOTOS} фото.`
            : `Додайте ще ${missingPhotoReportPhotos} фото. Мінімум — ${PHOTO_REPORT_MIN_PHOTOS}.`}
        </p>
      ) : null}

      {error ? (
        <div className="callout callout-danger"><AlertTriangleIcon size={18} className="callout-icon" />{error}</div>
      ) : null}

      {/* Sticky CTA bar */}
      <div className="bottom-action-bar">
        <div className="mx-auto flex w-full max-w-md gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-back"
          >
            Назад
          </button>
          <button
            type="submit"
            disabled={submitting || (isSellerPhotoReport && !currentPhotoReportStore) || !hasEnoughPhotoReportPhotos}
            className="btn-primary flex-1"
          >
            {submitting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-on-brand/40 border-t-on-brand" />
                Надсилаємо…
              </>
            ) : (
              "Надіслати"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
