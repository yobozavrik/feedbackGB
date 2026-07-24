"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildCatalogQuery,
  mergeCatalogPage,
  type CatalogItem,
  type CatalogResponse,
} from "@/lib/consumablesCatalog";

type CartItem = CatalogItem & { quantity: number };

function Thumb({ url, name }: { url: string | null; name: string }) {
  if (!url) {
    return <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-elev2 text-ink-500" aria-hidden>📦</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-12 w-12 flex-shrink-0 rounded-lg border border-ink-300/20 object-cover" loading="lazy" />;
}

export function ConsumablesCart() {
  const router = useRouter();
  const [view, setView] = useState<"catalog" | "cart">("catalog");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Stable across retries of the SAME cart, so the CRM idempotency key on
  // feedback_id matches server-side and a partial-success retry can't create
  // a second order.
  const submissionIdRef = useRef<string | null>(null);

  const loadPage = useCallback(async (targetPage: number, reset: boolean, searchValue: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/consumables/catalog?${buildCatalogQuery(targetPage, searchValue)}`);
      if (!res.ok) throw new Error();
      const body = (await res.json()) as CatalogResponse;
      setCatalog((prev) => mergeCatalogPage(prev, body.items ?? [], reset));
      setPage(body.page ?? targetPage);
      setTotalPages(body.total_pages ?? 1);
    } catch {
      setError("Не вдалося завантажити каталог");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void loadPage(1, true, search), search ? 250 : 0);
    return () => clearTimeout(handle);
  }, [search, loadPage]);

  function addToCart(item: CatalogItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { ...item, quantity: 1 }];
    });
  }
  function updateQty(id: number, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    );
  }
  function removeFromCart(id: number) {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }

  async function submit() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    if (!submissionIdRef.current) submissionIdRef.current = crypto.randomUUID();
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "consumables_request",
          fields: { comment: comment.trim() || null },
          cart_items: cart.map((c) => ({ product_id: c.id, quantity: c.quantity })),
          client_submission_id: submissionIdRef.current,
          client_created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Помилка");
      }
      submissionIdRef.current = null;
      router.push("/home/thanks");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Помилка");
      setSubmitting(false);
    }
  }

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);

  if (view === "cart") {
    return (
      <div className="card animate-fade-up p-4 pb-24">
        <button
          type="button"
          onClick={() => setView("catalog")}
          className="mb-4 inline-flex h-8 items-center rounded-full px-2 text-[12px] font-semibold text-brand-500 hover:bg-elev2"
        >
          ← До каталогу
        </button>
        <h2 className="mb-3 font-display text-[18px] font-semibold text-ink-900">
          Кошик · {cartCount} шт
        </h2>
        {cart.length === 0 ? (
          <p className="text-[13px] text-ink-500">Порожньо. Додай позиції з каталогу.</p>
        ) : (
          <ul className="space-y-2">
            {cart.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-ink-300/20 p-2">
                <Thumb url={c.photo_url} name={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink-900">{c.name}</p>
                  <p className="text-[11px] text-ink-500">{c.unit ?? "шт"}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => updateQty(c.id, -1)} className="h-8 w-8 rounded-full bg-elev2 text-lg" aria-label="Менше">−</button>
                  <span className="w-8 text-center text-[14px] font-semibold">{c.quantity}</span>
                  <button type="button" onClick={() => updateQty(c.id, 1)} className="h-8 w-8 rounded-full bg-elev2 text-lg" aria-label="Більше">+</button>
                  <button type="button" onClick={() => removeFromCart(c.id)} className="ml-1 h-8 w-8 rounded-full bg-elev2 text-sm text-brand-600" aria-label="Видалити">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <label htmlFor="comment" className="field-label">Коментар</label>
          <textarea
            id="comment"
            placeholder="Особливі побажання (необов'язково)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="field-textarea"
          />
        </div>

        {submitError ? (
          <div role="alert" className="mt-3 rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
            {submitError}
          </div>
        ) : null}

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex max-w-md gap-2">
            <button type="button" onClick={() => setView("catalog")} className="btn-ghost px-4">До каталогу</button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || cart.length === 0}
              className="btn-primary flex-1"
            >
              {submitting ? "Відправляємо…" : `Відправити (${cartCount})`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-3 pb-24">
      <input
        type="search"
        placeholder="Пошук за назвою…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="field-input"
      />

      {error ? (
        <div role="alert" className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
          {error}
        </div>
      ) : null}

      <ul className="space-y-2">
        {catalog.map((item) => {
          const inCart = cart.find((c) => c.id === item.id);
          return (
            <li key={item.id} className="flex items-center gap-3 rounded-lg border border-ink-300/20 bg-elev p-2 shadow-soft">
              <Thumb url={item.photo_url} name={item.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink-900">{item.name}</p>
                <p className="text-[11px] text-ink-500">
                  {item.unit ?? "шт"}{item.category_name ? ` · ${item.category_name}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => addToCart(item)}
                className={`h-9 rounded-full px-3 text-[12px] font-semibold ${inCart ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-600"}`}
              >
                {inCart ? `× ${inCart.quantity}` : "+ Додати"}
              </button>
            </li>
          );
        })}
      </ul>

      {loading ? <p className="text-center text-[12px] text-ink-500">Завантаження…</p> : null}
      {!loading && page < totalPages ? (
        <button
          type="button"
          onClick={() => void loadPage(page + 1, false, search)}
          className="btn-ghost w-full"
        >
          Показати ще
        </button>
      ) : null}

      {cartCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={() => setView("cart")}
              className="btn-primary w-full"
            >
              До кошика · {cartCount} позиц.
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
