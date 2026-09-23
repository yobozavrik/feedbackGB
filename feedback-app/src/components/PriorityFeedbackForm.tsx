"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/categories";
import { track } from "@/lib/analytics";
import { formatProductUnitUk } from "@/lib/productUnits";
import type { ProductRow } from "@/app/api/products/route";
import type { FeedbackPayload } from "@/lib/types";
import { useTelegram } from "./TelegramProvider";
import { PhotoInput } from "./PhotoInput";
import { StoreSelect } from "./StoreSelect";
import { ProductPicker } from "./ProductPicker";
import { QuantityStepper } from "./QuantityStepper";
import { ConfirmSheet } from "./ConfirmSheet";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudUploadIcon,
  MapPinIcon,
  PlusIcon,
} from "@/components/icons";

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

const cdnBase = (
  process.env.NEXT_PUBLIC_POSTER_CDN_BASE_URL ?? "https://joinposter.com"
).replace(/\/$/, "");

/**
 * Streamlined form for the v1 priority categories (Мало / Багато / Брак).
 *
 * Flow: pick product → adjust quantity → optional photo + comment → confirm → submit.
 * Falls back to a free-text "name" input if the seller can't find the item
 * in the POS catalog (toggle "Товару нема в каталозі").
 */
export function PriorityFeedbackForm({ category }: Props) {
  const router = useRouter();
  const { initData, webApp } = useTelegram();

  const [me, setMe] = useState<SessionUser | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [freeName, setFreeName] = useState("");
  const [useFreeName, setUseFreeName] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  const [storeIdAdmin, setStoreIdAdmin] = useState<number | null>(null);
  const [storeLabelAdmin, setStoreLabelAdmin] = useState<string>("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineSaved, setOfflineSaved] = useState(false);

  const formStartedRef = useRef(false);
  const submittedRef = useRef(false);

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

  // Fire `feedback_form_started` once, the first time the seller does
  // anything that's a real intent signal (picking a product, typing a name,
  // typing a comment). This is the top of our drop-off funnel.
  useEffect(() => {
    if (formStartedRef.current) return;
    if (product || freeName.trim() || comment.trim()) {
      formStartedRef.current = true;
      track("feedback_form_started", { category: category.id });
    }
  }, [product, freeName, comment, category.id]);

  // Detect abandonment: page-leave / unmount without submitting after the
  // form was started. Helps spot "opened, almost finished, gave up" cases.
  useEffect(() => {
    function flushAbandon() {
      if (!formStartedRef.current || submittedRef.current) return;
      track("feedback_form_abandon", {
        category: category.id,
        had_product: !!product,
        had_photo: photos.length > 0,
        had_comment: !!comment.trim(),
      });
    }
    window.addEventListener("beforeunload", flushAbandon);
    return () => {
      window.removeEventListener("beforeunload", flushAbandon);
      flushAbandon();
    };
  }, [category.id, product, photos.length, comment]);

  if (!meReady) {
    return (
      <div className="card space-y-4 p-5">
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-13 w-full rounded-app" />
        <div className="skeleton h-13 w-full rounded-app" />
      </div>
    );
  }

  const lockedStoreId = me?.role === "seller" ? me.store_id : null;
  const effectiveStoreId = lockedStoreId ?? storeIdAdmin;

  function pickProduct(p: ProductRow) {
    setProduct(p);
    setUseFreeName(false);
    setFreeName("");
    setPickerOpen(false);
    webApp?.HapticFeedback?.impactOccurred("light");
    track("feedback_product_picked", {
      category: category.id,
      product_id: p.id,
      has_unit: !!p.unit,
    });
  }

  function clearProduct() {
    setProduct(null);
  }

  // Validation for the form before opening the confirm sheet
  function tryConfirm() {
    setError(null);

    if (!product && !useFreeName) {
      setError("Обери товар зі списку або натисни «Нема в каталозі».");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    if (useFreeName && !freeName.trim()) {
      setError("Напиши назву товару.");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Вкажи кількість — хоча б 1.");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    if (effectiveStoreId === null && !storeLabelAdmin.trim()) {
      setError("Обери магазин.");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    track("feedback_submit_click", {
      category: category.id,
      has_product: !!product,
      used_free_name: useFreeName,
      quantity,
      has_photo: photos.length > 0,
      has_comment: !!comment.trim(),
    });
    setConfirmOpen(true);
  }

  async function doSubmit() {
    setSubmitting(true);
    setError(null);

    const fields: Record<string, string | number | null> = {};
    if (useFreeName && freeName.trim()) {
      fields.item_name = freeName.trim();
    }
    if (comment.trim()) {
      fields.comment = comment.trim();
    }

    const clientSubmissionId = window.crypto.randomUUID();
    const clientCreatedAt = new Date().toISOString();

    const payload: FeedbackPayload = {
      category: category.id,
      store_id: effectiveStoreId,
      store_label:
        effectiveStoreId === null ? storeLabelAdmin.trim() || null : null,
      product_id: product?.id ?? null,
      quantity,
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
      submittedRef.current = true;
      track("feedback_submit_success", { category: category.id });
      webApp?.HapticFeedback?.notificationOccurred("success");
      router.push(`/thanks?cat=${category.id}`);
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);
      track("feedback_submit_failure", {
        category: category.id,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });

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
          submittedRef.current = true;
          setOfflineSaved(true);
        } catch (saveErr) {
          console.error("Failed to save offline submission:", saveErr);
          setError(
            saveErr instanceof Error ? saveErr.message : "Помилка при збереженні офлайн-заявки",
          );
          webApp?.HapticFeedback?.notificationOccurred("error");
          setConfirmOpen(false);
        }
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Не вдалося відправити. Спробуй ще раз.",
        );
        webApp?.HapticFeedback?.notificationOccurred("error");
        setConfirmOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (offlineSaved) {
    return (
      <div className="card animate-fade-up space-y-6 p-6 text-center">
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

  const productLabel = product?.name ?? (useFreeName ? freeName.trim() : "");
  const productUnit = product?.unit ?? null;

  return (
    <div className="space-y-4 pb-24">
      {/* Identity + store row */}
      <div className="card flex flex-wrap items-center gap-2 p-4">
        {me ? (
          <span className="pill bg-elev2 text-ink-700">
            Від: <span className="font-medium text-ink-900">{me.full_name}</span>
          </span>
        ) : null}
        {lockedStoreId && storeName ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-elev2 px-3 py-1.5 text-[14px] font-medium text-ink-900">
                <MapPinIcon size={16} className="text-ink-500" />
                {storeName}
              </span>
        ) : null}
      </div>

      {!lockedStoreId ? (
        <div className="card p-4">
          <StoreSelect
            onChange={(id, label) => {
              setStoreIdAdmin(id);
              setStoreLabelAdmin(label);
            }}
          />
        </div>
      ) : null}

      {/* Product slot — the heart of the priority flow */}
      <div className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-[15px] font-semibold text-ink-900">
            Який товар?
          </h3>
          <button
            type="button"
            onClick={() => {
              setUseFreeName((v) => {
                const next = !v;
                if (next) setProduct(null);
                return next;
              });
            }}
            className="link"
          >
            {useFreeName ? (
              <><ChevronLeftIcon size={16} /> Обрати з каталогу</>
            ) : (
              <>Нема в каталозі <ChevronRightIcon size={16} /></>
            )}
          </button>
        </div>

        {useFreeName ? (
          <input
            type="text"
            value={freeName}
            onChange={(e) => setFreeName(e.target.value)}
            placeholder="Наприклад: новий сезонний напій"
            className="field-input"
            maxLength={120}
            autoFocus
          />
        ) : product ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center gap-3 rounded-app border border-ink-300/35 bg-elev p-3 text-left hover:border-brand-500/40"
          >
            <ProductThumb photo={product.photo} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink-900">
                {product.name}
              </span>
              <span className="block text-meta text-ink-500">
                {formatProductUnitUk(product.unit) ?? "Одиницю не вказано"}
                {product.category_name ? ` · ${product.category_name}` : ""}
              </span>
            </span>
            <span className="link">Змінити</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-app border-[1.5px] border-dashed border-ink-300 bg-elev2 px-4 text-[15px] font-medium text-ink-700 hover:border-brand-500/40 hover:text-brand-600"
          >
            <PlusIcon size={18} /> Обрати товар
          </button>
        )}

        {product || useFreeName ? (
          <div className="mt-4">
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              min={0}
              step={1}
              unit={productUnit}
              label={category.id === "defect" ? "Скільки браку" : "Скільки одиниць"}
            />
          </div>
        ) : null}
      </div>

      {/* Comment + photo */}
      {(product || useFreeName) ? (
        <div className="card space-y-4 p-4">
          <div>
            <label htmlFor="comment" className="field-label">
              {category.id === "defect" ? (
                <>Деталі <span className="text-brand-500">*</span></>
              ) : (
                "Коментар (необов'язково)"
              )}
            </label>
            <textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                category.id === "defect"
                  ? "Що саме не так, коли помітила"
                  : category.id === "overstock"
                    ? "Скільки днів лежить, чи псується"
                    : "Що клієнт казав, чим заміняли"
              }
              maxLength={1000}
              required={category.id === "defect"}
              className="field-textarea"
            />
          </div>
          <PhotoInput
            label={
              category.id === "defect"
                ? "Фото браку (дуже бажано)"
                : "Фото полиці (необов'язково)"
            }
            onChange={setPhotos}
          />
        </div>
      ) : null}

      {error ? (
        <div className="callout callout-danger"><AlertTriangleIcon size={18} className="callout-icon" />{error}</div>
      ) : null}

      {/* Sticky CTA */}
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
            type="button"
            onClick={tryConfirm}
            disabled={submitting || (!product && !useFreeName)}
            className="btn-primary flex-1"
          >
            Далі <ChevronRightIcon size={18} />
          </button>
        </div>
      </div>

      <ProductPicker
        open={pickerOpen}
        storeId={effectiveStoreId}
        onSelect={pickProduct}
        onClose={() => setPickerOpen(false)}
      />

      <ConfirmSheet
        open={confirmOpen}
        title="Все правильно?"
        submitting={submitting}
        lines={[
          {
            label: "Категорія",
            value: `${category.emoji} ${category.title}`,
          },
          { label: "Товар", value: productLabel || "—" },
          {
            label: "Кількість",
            value: `${formatQty(quantity)}${productUnit ? ` ${productUnit}` : ""}`,
          },
          {
            label: "Магазин",
            value:
              storeName ??
              storeLabelAdmin ??
              (effectiveStoreId !== null ? `#${effectiveStoreId}` : "—"),
          },
        ]}
        onConfirm={doSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function formatQty(n: number): string {
  if (Number.isNaN(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

function ProductThumb({ photo }: { photo: string | null }) {
  if (!photo) {
    return (
      <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-elev text-[22px]">
        🥟
      </span>
    );
  }
  const url = photo.startsWith("http") ? photo : `${cdnBase}${photo}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-12 w-12 flex-shrink-0 rounded-xl bg-elev object-cover"
      loading="lazy"
    />
  );
}
