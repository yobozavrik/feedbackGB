"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/categories";
import { track } from "@/lib/analytics";
import type { ProductRow } from "@/app/api/products/route";
import type { FeedbackPayload } from "@/lib/types";
import { useTelegram } from "./TelegramProvider";
import { PhotoInput } from "./PhotoInput";
import { StoreSelect } from "./StoreSelect";
import { ProductPicker } from "./ProductPicker";
import { QuantityStepper } from "./QuantityStepper";
import { ConfirmSheet } from "./ConfirmSheet";

interface Props {
  category: Category;
}

interface SessionUser {
  full_name: string;
  role: "seller" | "admin";
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
  const [photo, setPhoto] = useState<string | null>(null);

  const [storeIdAdmin, setStoreIdAdmin] = useState<number | null>(null);
  const [storeLabelAdmin, setStoreLabelAdmin] = useState<string>("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        had_photo: !!photo,
        had_comment: !!comment.trim(),
      });
    }
    window.addEventListener("beforeunload", flushAbandon);
    return () => {
      window.removeEventListener("beforeunload", flushAbandon);
      flushAbandon();
    };
  }, [category.id, product, photo, comment]);

  if (!meReady) {
    return (
      <div className="card space-y-4 p-5">
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-13 w-full rounded-2xl" />
        <div className="skeleton h-13 w-full rounded-2xl" />
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
      setError("Обери товар із каталогу або позначай вручну.");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    if (useFreeName && !freeName.trim()) {
      setError("Напиши назву товару.");
      webApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Кількість має бути більше 0.");
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
      has_photo: !!photo,
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

    const payload: FeedbackPayload = {
      category: category.id,
      store_id: effectiveStoreId,
      store_label:
        effectiveStoreId === null ? storeLabelAdmin.trim() || null : null,
      product_id: product?.id ?? null,
      quantity,
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
      submittedRef.current = true;
      track("feedback_submit_success", { category: category.id });
      webApp?.HapticFeedback?.notificationOccurred("success");
      router.push(`/thanks?cat=${category.id}`);
    } catch (err) {
      console.error(err);
      track("feedback_submit_failure", {
        category: category.id,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      setError(
        err instanceof Error
          ? err.message
          : "Не вдалось відправити. Спробуй ще раз.",
      );
      webApp?.HapticFeedback?.notificationOccurred("error");
      setSubmitting(false);
      setConfirmOpen(false);
    }
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
          <span className="pill bg-cat-missing/40 text-ink-900">
            <span aria-hidden>📍</span>
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
            className="text-[12px] font-medium text-brand-600 hover:underline"
          >
            {useFreeName ? "← Обрати з каталогу" : "Нема в каталозі →"}
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
            className="flex w-full items-center gap-3 rounded-2xl border border-ink-300/20 bg-elev2 p-3 text-left hover:border-brand-500/40"
          >
            <ProductThumb photo={product.photo} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink-900">
                {product.name}
              </span>
              <span className="block text-[12px] text-ink-500">
                {product.unit ?? "шт"}
                {product.category_name ? ` · ${product.category_name}` : ""}
              </span>
            </span>
            <span className="text-[12px] font-medium text-brand-600">
              Змінити
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-300/40 bg-elev2 px-4 text-[15px] font-medium text-ink-700 hover:border-brand-500/40 hover:text-brand-600"
          >
            <span aria-hidden>＋</span> Обрати товар
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
              Коментар (необов&apos;язково)
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
              className="field-textarea"
            />
          </div>
          <PhotoInput
            label={
              category.id === "defect"
                ? "Фото браку (дуже бажано)"
                : "Фото полиці (необов'язково)"
            }
            onChange={setPhoto}
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-300/40 bg-rose-50 px-4 py-3 text-[14px] text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-ghost px-4"
          >
            Назад
          </button>
          <button
            type="button"
            onClick={tryConfirm}
            disabled={submitting || (!product && !useFreeName)}
            className="btn-primary flex-1"
          >
            Далі →
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
