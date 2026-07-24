"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "./TelegramProvider";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CartIcon,
  EditIcon,
  MinusIcon,
  PackageIcon,
  PlusCircleIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
  TrashIcon,
} from "./icons";

import {
  buildCatalogQuery,
  mergeCatalogPage,
  type CatalogItem,
  type CatalogResponse,
} from "@/lib/consumablesCatalog";

type CartItem = CatalogItem & { quantity: number };

/** Product thumbnail with a graceful icon fallback when there's no photo. */
function Thumb({ url, name, size = "h-12 w-12" }: { url: string | null; name: string; size?: string }) {
  if (!url) {
    return (
      <span className={`${size} flex flex-shrink-0 items-center justify-center rounded-lg bg-[#f0edef] text-ink-500`}>
        <PackageIcon size={22} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`${size} flex-shrink-0 rounded-lg border border-ink-300/20 object-cover`} loading="lazy" />;
}

export function ConsumablesCartForm() {
  const router = useRouter();
  const { initData, webApp } = useTelegram();
  const [view, setView] = useState<"catalog" | "cart">("catalog");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Stable across retries of the SAME cart: the warehouse CRM is idempotent by
  // feedback_id (== this id), so reusing it means a retry after a partial
  // success (CRM accepted, journal write failed) can't create a second order.
  // Deliberately NOT regenerated when the cart changes — a fresh id there would
  // re-introduce that duplication. Reset only after a confirmed success.
  const submissionIdRef = useRef<string | null>(null);

  // Fetch one catalog page. `search` is passed explicitly (not closed over) so
  // this stays safe to call from both the debounced effect and the load-more
  // handler without stale-closure surprises.
  async function loadCatalogPage(
    targetPage: number,
    reset: boolean,
    searchValue: string,
    signal?: AbortSignal,
  ) {
    if (reset) setLoading(true); else setLoadingMore(true);
    setCatalogError(null);
    try {
      const response = await fetch(
        `/api/consumables/catalog?${buildCatalogQuery(targetPage, searchValue)}`,
        { signal },
      );
      if (!response.ok) throw new Error("Не вдалося завантажити каталог");
      const body = await response.json() as CatalogResponse;
      setCatalog((prev) => mergeCatalogPage(prev, body.items ?? [], reset));
      setPage(targetPage);
      setTotalPages(body.total_pages ?? 1);
    } catch (cause) {
      if (!signal?.aborted) setCatalogError(cause instanceof Error ? cause.message : "Не вдалося завантажити каталог");
    } finally {
      if (!signal?.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }

  // New search (debounced) or manual retry always restarts at page 1.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadCatalogPage(1, true, search, controller.signal);
    }, 180);
    return () => { controller.abort(); clearTimeout(timer); };
    // loadCatalogPage is intentionally omitted: it's re-created every render
    // and including it would restart the fetch on each keystroke's re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, reloadKey]);

  const hasMore = page < totalPages;
  const busy = loading || loadingMore;
  function loadMore() {
    if (!hasMore || busy) return;
    void loadCatalogPage(page + 1, false, search);
  }

  // Auto-load the next page when the sentinel scrolls into view; the visible
  // "Показати ще" button stays as an explicit fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || busy) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, busy, page, search]);

  const totalUnits = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const cartItem = (id: number) => cart.find((item) => item.id === id);
  const setQuantity = (id: number, quantity: number) =>
    setCart((items) => quantity <= 0
      ? items.filter((item) => item.id !== id)
      : items.map((item) => item.id === id ? { ...item, quantity } : item));
  const add = (item: CatalogItem) => setCart((items) => {
    const existing = items.find((row) => row.id === item.id);
    return existing
      ? items.map((row) => row.id === item.id ? { ...row, quantity: row.quantity + 1 } : row)
      : [...items, { ...item, quantity: 1 }];
  });
  const remove = (id: number) => setCart((items) => items.filter((item) => item.id !== id));

  async function submit() {
    if (!cart.length) { setInlineError("Додайте хоча б один розхідний матеріал"); setView("catalog"); return; }
    setSubmitting(true);
    setSubmitError(null);
    // Lazily mint once, then reuse for every retry of this cart. Becomes the
    // feedback record id for consumables, which /thanks uses to look up the
    // real order stage.
    if (!submissionIdRef.current) submissionIdRef.current = crypto.randomUUID();
    const submissionId = submissionIdRef.current;
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "consumables_request",
          fields: { comment: comment.trim() || null },
          cart_items: cart.map(({ id, quantity }) => ({ product_id: id, quantity })),
          init_data: initData || undefined,
          client_submission_id: submissionId,
          client_created_at: new Date().toISOString(),
        }),
      });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || "Не вдалося відправити заявку"); }
      webApp?.HapticFeedback?.notificationOccurred("success");
      // Confirmed accepted — a subsequent order must get a fresh id.
      submissionIdRef.current = null;
      router.push(`/home/thanks?cat=consumables_request&id=${submissionId}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Не вдалося відправити заявку");
      webApp?.HapticFeedback?.notificationOccurred("error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Full-screen: submitting ────────────────────────────────────────────────
  if (submitting) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-[100svh] flex-col items-center justify-center bg-[#f2f2f7] px-6 text-center">
        <SpinnerIcon size={48} className="text-[#0058bc]" />
        <h1 className="mt-6 text-xl font-bold text-[#1b1b1d]">Відправка заявки…</h1>
        <p className="mt-2 max-w-xs text-[15px] leading-5 text-[#414755]">Будь ласка, не закривайте додаток.</p>
      </div>
    );
  }

  // ── Full-screen: submit failed (cart preserved) ────────────────────────────
  if (submitError) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-[100svh] flex-col bg-[#f2f2f7]">
        <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#ffdad6] text-[#ba1a1a]">
            <AlertCircleIcon size={44} />
          </div>
          <h1 className="mt-6 text-[22px] font-bold text-[#1b1b1d]">Помилка відправки</h1>
          <p className="mt-3 max-w-xs text-[15px] leading-5 text-[#414755]">
            Заявка не була прийнята складом. Ваша корзина збережена.
          </p>
          <div className="mt-8 w-full max-w-sm rounded-xl border border-[#c1c6d7] bg-white p-4 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#414755]">Деталі</p>
            <p className="mt-1 text-[15px] text-[#1b1b1d]">{submitError}</p>
            <p className="mt-2 text-[13px] text-[#414755]">{cart.length} поз. · {totalUnits} од. збережено</p>
          </div>
        </main>
        <footer className="border-t border-[#c1c6d7] bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <button
              type="button"
              onClick={() => { setSubmitError(null); void submit(); }}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#0058bc] text-[17px] font-semibold text-white active:scale-[0.98]"
            >
              <RefreshIcon size={20} /> Спробувати ще раз
            </button>
            <button
              type="button"
              // Refresh the catalog on the way back: a common cause of refusal
              // is a product going inactive after the catalog was loaded, so
              // returning to a stale list would just reproduce the error.
              onClick={() => { setSubmitError(null); setReloadKey((k) => k + 1); setView("cart"); }}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-[#0058bc] bg-transparent text-[17px] font-semibold text-[#0058bc] active:scale-[0.98]"
            >
              <EditIcon size={20} /> Редагувати кошик
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // ── Screen A: catalog ──────────────────────────────────────────────────────
  if (view === "catalog") {
    return (
      <div className="space-y-3 pb-28">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">Розхідні матеріали</h1>
          <p className="mt-1 text-sm text-ink-700">Знайдіть товар і додайте потрібну кількість.</p>
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
            <SearchIcon size={20} />
          </span>
          <label className="sr-only" htmlFor="consumables-search">Пошук матеріалу</label>
          <input
            id="consumables-search"
            autoFocus
            className="field-input pl-10"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Пошук за назвою"
          />
        </div>

        {inlineError ? (
          <p className="rounded-lg bg-[#ffdad6] px-3 py-2 text-sm text-[#93000a]">{inlineError}</p>
        ) : null}

        {catalogError ? (
          <div className="card flex flex-col items-center gap-3 p-6 text-center">
            <span className="text-ink-500"><AlertCircleIcon size={32} /></span>
            <p className="text-sm text-ink-700">{catalogError}</p>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn-ghost h-11 gap-2 px-4">
              <RefreshIcon size={18} /> Спробувати ще раз
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[76px] rounded-xl" />)}
          </div>
        ) : (
          <section className="space-y-2">
            {catalog.map((item) => {
              const selected = cartItem(item.id);
              return (
                <article key={item.id} className="card flex min-h-[76px] items-center gap-3 p-3.5">
                  <Thumb url={item.photo_url} name={item.name} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium text-ink-900">{item.name}</h2>
                    <p className="mt-1 text-xs text-ink-500">
                      {item.unit ?? "шт"}{item.category_name ? ` · ${item.category_name}` : ""}
                    </p>
                  </div>
                  {selected ? (
                    <div className="flex h-11 items-center overflow-hidden rounded-lg border border-brand-500/50">
                      <button type="button" aria-label="Зменшити" onClick={() => setQuantity(item.id, selected.quantity - 1)} className="flex h-11 w-11 items-center justify-center text-brand-600 active:bg-brand-50/60">
                        <MinusIcon size={18} />
                      </button>
                      <span className="flex w-10 items-center justify-center border-x border-brand-500/35 font-semibold text-ink-900">{selected.quantity}</span>
                      <button type="button" aria-label="Збільшити" onClick={() => setQuantity(item.id, selected.quantity + 1)} className="flex h-11 w-11 items-center justify-center text-brand-600 active:bg-brand-50/60">
                        <PlusIcon size={18} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => add(item)} className="btn-primary h-11 shrink-0 gap-1.5 px-4">
                      <PlusIcon size={18} /> Додати
                    </button>
                  )}
                </article>
              );
            })}
            {catalog.length === 0 ? (
              <div className="card flex flex-col items-center gap-2 p-6 text-center">
                <span className="text-ink-500"><SearchIcon size={28} /></span>
                <p className="text-sm text-ink-500">Нічого не знайдено</p>
              </div>
            ) : null}

            {hasMore ? (
              <div ref={sentinelRef} className="pt-1">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={busy}
                  className="btn-ghost h-12 w-full gap-2"
                >
                  {loadingMore ? <><SpinnerIcon size={18} /> Завантаження…</> : "Показати ще"}
                </button>
              </div>
            ) : null}
          </section>
        )}

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#c1c6d7] bg-white/90 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl">
          <div className="mx-auto max-w-md">
            <button type="button" onClick={() => setView("cart")} disabled={cart.length === 0} className="btn-primary w-full gap-2">
              <CartIcon size={20} />
              {cart.length ? `Кошик · ${cart.length} поз. · ${totalUnits} од.` : "Кошик порожній"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Screen B: cart review ──────────────────────────────────────────────────
  return (
    <div className="-mx-4 min-h-[calc(100svh-4rem)] bg-[#f2f2f7] pb-40 sm:-mx-6">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#c1c6d7] bg-white px-4 py-3">
        <button type="button" onClick={() => setView("catalog")} className="flex h-10 w-10 items-center justify-center rounded-lg text-[#0058bc] active:bg-[#f0edef]" aria-label="Назад">
          <ArrowLeftIcon size={24} />
        </button>
        <h1 className="text-xl font-bold text-[#1b1b1d]">Кошик ({cart.length} поз.)</h1>
        <span className="flex h-10 w-10 items-center justify-center text-[#0058bc]"><CartIcon size={22} /></span>
      </div>

      <main className="space-y-4 px-4 py-4">
        <section className="overflow-hidden rounded-xl border border-[#c1c6d7] bg-white">
          {cart.map((item) => (
            <article key={item.id} className="border-b border-[#d1d1d6] p-4 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Thumb url={item.photo_url} name={item.name} />
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold leading-[22px] text-[#1b1b1d]">{item.name}</h2>
                    <p className="mt-1 text-[13px] text-[#414755]">Одиниця: {item.unit ?? "шт"}</p>
                  </div>
                </div>
                <button type="button" onClick={() => remove(item.id)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#ba1a1a] active:scale-95" aria-label={`Видалити ${item.name}`}>
                  <TrashIcon size={20} />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#414755]">Кількість:</span>
                <div className="flex items-center rounded-lg bg-[#f0edef] p-1">
                  <button type="button" onClick={() => setQuantity(item.id, item.quantity - 1)} className="flex h-10 w-10 items-center justify-center rounded-md text-[#0058bc] active:bg-[#eae7ea]" aria-label="Зменшити">
                    <MinusIcon size={20} />
                  </button>
                  <span className="w-12 text-center text-[17px] font-semibold">{item.quantity}</span>
                  <button type="button" onClick={() => setQuantity(item.id, item.quantity + 1)} className="flex h-10 w-10 items-center justify-center rounded-md text-[#0058bc] active:bg-[#eae7ea]" aria-label="Збільшити">
                    <PlusIcon size={20} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        <div className="flex justify-center">
          <button type="button" onClick={() => setView("catalog")} className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-[#0058bc] active:opacity-60">
            <PlusCircleIcon size={18} /> Продовжити вибір
          </button>
        </div>

        <div>
          <label className="mb-1 block px-1 text-[13px] font-medium text-[#414755]" htmlFor="consumables-comment">Коментар для комірника</label>
          <textarea
            id="consumables-comment"
            className="min-h-[100px] w-full resize-none rounded-xl border border-[#c1c6d7] bg-white p-4 text-[15px] text-[#1b1b1d] outline-none focus:border-[#0070eb]"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            placeholder="Наприклад: Залишити біля дверей…"
          />
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-[#c1c6d7] bg-white/90 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-lg backdrop-blur-xl">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={submit} disabled={cart.length === 0} className="flex h-14 w-full items-center justify-center rounded-xl bg-[#0058bc] text-[17px] font-semibold text-white active:scale-[0.98] disabled:opacity-50">
            Відправити заявку
          </button>
          <p className="mt-2 text-center text-[13px] text-[#414755]">Заявка потрапить прямо на склад</p>
        </div>
      </footer>
    </div>
  );
}
