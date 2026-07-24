"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogItem } from "@/lib/consumablesCatalog";

interface Category {
  id: number;
  name: string;
}
interface DraftItem {
  product_id: number;
  quantity: number;
  name?: string;
  unit?: string | null;
  photo_url?: string | null;
}
interface Draft {
  id: string;
  cart_items: DraftItem[];
  comment: string | null;
}

const SUGGEST_DEBOUNCE_MS = 220;
const AUTOSAVE_DEBOUNCE_MS = 500;
const SUGGEST_LIMIT = 10;

function Thumb({ url }: { url: string | null | undefined }) {
  if (!url) {
    return (
      <span
        aria-hidden
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-elev2 text-ink-500"
      >
        📦
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-11 w-11 flex-shrink-0 rounded-lg border border-ink-300/20 object-cover"
    />
  );
}

export function ConsumablesCart() {
  const router = useRouter();

  // draft state
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // catalog / search
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  // quantity modal
  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [pendingQty, setPendingQty] = useState("1");

  // === draft load =========================================================
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/drafts/consumables");
      if (r.ok) {
        const j = (await r.json()) as { draft: Draft };
        setDraft(j.draft);
        setComment(j.draft.comment ?? "");
      } else if (r.status === 401) {
        window.location.assign("/");
      } else {
        setError("Не вдалося завантажити чернетку");
      }
    })();
  }, []);

  // === categories =========================================================
  useEffect(() => {
    fetch("/api/consumables/categories")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("cats"))))
      .then((j: { categories?: Category[] }) => setCategories(j.categories ?? []))
      .catch(() => {
        // silent — chips are optional UX
      });
  }, []);

  // === typeahead ==========================================================
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2 && !activeCategory) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const handle = setTimeout(() => {
      setSuggestLoading(true);
      const params = new URLSearchParams({ page: "1", page_size: String(SUGGEST_LIMIT) });
      if (q) params.set("search", q);
      if (activeCategory) params.set("category_id", String(activeCategory));
      fetch(`/api/consumables/catalog?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("cat"))))
        .then((j: { items?: CatalogItem[] }) => {
          setSuggestions(j.items ?? []);
          setSuggestOpen(true);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestLoading(false));
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search, activeCategory]);

  // === draft auto-save ====================================================
  const savingRef = useRef<AbortController | null>(null);
  const saveDraft = useCallback(async (items: DraftItem[], nextComment: string) => {
    savingRef.current?.abort();
    const ctl = new AbortController();
    savingRef.current = ctl;
    try {
      const r = await fetch("/api/drafts/consumables", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cart_items: items, comment: nextComment || null }),
        signal: ctl.signal,
      });
      if (r.ok) {
        const j = (await r.json()) as { draft: Draft };
        setDraft(j.draft);
      }
    } catch {
      // aborted or offline — next edit will retry
    }
  }, []);

  // debounce comment writes
  useEffect(() => {
    if (!draft) return;
    if ((draft.comment ?? "") === comment) return;
    const handle = setTimeout(() => {
      void saveDraft(draft.cart_items, comment);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [comment, draft, saveDraft]);

  // === cart operations ====================================================
  function addToCart(item: CatalogItem, qty: number) {
    if (!draft) return;
    const existing = draft.cart_items.find((c) => c.product_id === item.id);
    let next: DraftItem[];
    if (existing) {
      next = draft.cart_items.map((c) =>
        c.product_id === item.id ? { ...c, quantity: Math.round((c.quantity + qty) * 1000) / 1000 } : c,
      );
    } else {
      next = [
        ...draft.cart_items,
        {
          product_id: item.id,
          quantity: qty,
          name: item.name,
          unit: item.unit ?? null,
          photo_url: item.photo_url ?? null,
        },
      ];
    }
    setDraft({ ...draft, cart_items: next });
    void saveDraft(next, comment);
  }

  function updateQty(pid: number, qty: number) {
    if (!draft) return;
    const next = draft.cart_items
      .map((c) => (c.product_id === pid ? { ...c, quantity: qty } : c))
      .filter((c) => c.quantity > 0);
    setDraft({ ...draft, cart_items: next });
    void saveDraft(next, comment);
  }

  function removeItem(pid: number) {
    updateQty(pid, 0);
  }

  // === suggestion tap → open qty modal ====================================
  function openQtyModal(item: CatalogItem) {
    setPendingItem(item);
    setPendingQty("1");
    setSearch("");
    setSuggestOpen(false);
  }

  function confirmQty() {
    if (!pendingItem) return;
    const q = Number(pendingQty.replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) {
      setError("Кількість має бути більше 0");
      return;
    }
    addToCart(pendingItem, Math.round(q * 1000) / 1000);
    setPendingItem(null);
    setError(null);
  }

  // === submit =============================================================
  async function submit() {
    if (!draft || draft.cart_items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // ensure comment saved
      await saveDraft(draft.cart_items, comment);
      const r = await fetch("/api/drafts/consumables/submit", { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Не вдалося відправити");
      }
      router.push("/home/thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setSubmitting(false);
    }
  }

  const cartCount = useMemo(
    () => (draft?.cart_items ?? []).reduce((n, c) => n + c.quantity, 0),
    [draft],
  );
  const cart = draft?.cart_items ?? [];

  return (
    <div className="animate-fade-up space-y-4 pb-32">
      {/* === category chips === */}
      {categories.length > 0 ? (
        <div className="-mx-4 overflow-x-auto sm:-mx-6">
          <div className="flex gap-2 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`h-8 flex-shrink-0 rounded-full px-3 text-[12px] font-semibold ${
                activeCategory === null ? "bg-brand-500 text-white" : "bg-elev2 text-ink-700"
              }`}
            >
              Всі
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id === activeCategory ? null : c.id)}
                className={`h-8 flex-shrink-0 rounded-full px-3 text-[12px] font-semibold ${
                  activeCategory === c.id ? "bg-brand-500 text-white" : "bg-elev2 text-ink-700"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* === search + suggestions === */}
      <div className="relative">
        <input
          type="search"
          value={search}
          placeholder="Почни вводити назву…"
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => search.trim().length >= 2 && setSuggestOpen(true)}
          onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
          className="field-input"
          aria-autocomplete="list"
          aria-controls="suggest-list"
        />
        {suggestOpen && (suggestions.length > 0 || suggestLoading) ? (
          <ul
            id="suggest-list"
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-ink-300/30 bg-elev shadow-soft"
          >
            {suggestLoading && suggestions.length === 0 ? (
              <li className="px-3 py-4 text-center text-[13px] text-ink-500">Пошук…</li>
            ) : (
              suggestions.map((item) => (
                <li key={item.id} role="option">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openQtyModal(item)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-elev2"
                  >
                    <Thumb url={item.photo_url} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink-900">{item.name}</span>
                      <span className="block text-[11px] text-ink-500">
                        {item.unit ?? "шт"}
                        {item.category_name ? ` · ${item.category_name}` : ""}
                      </span>
                    </span>
                    <span className="text-brand-500" aria-hidden>＋</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {/* === cart === */}
      <section>
        <h2 className="mb-2 px-1 font-display text-[15px] font-semibold text-ink-900">
          Кошик · {cart.length} позиц.
        </h2>
        {cart.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-300/40 bg-elev p-4 text-center text-[13px] text-ink-500">
            Пусто. Знайди позиції через пошук.
          </p>
        ) : (
          <ul className="space-y-2">
            {cart.map((c) => (
              <li key={c.product_id} className="flex items-center gap-3 rounded-lg border border-ink-300/20 bg-elev p-2 shadow-soft">
                <Thumb url={c.photo_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink-900">{c.name ?? `#${c.product_id}`}</p>
                  <p className="text-[11px] text-ink-500">{c.unit ?? "шт"}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateQty(c.product_id, Math.max(0, c.quantity - 1))}
                    aria-label="Менше"
                    className="h-8 w-8 rounded-full bg-elev2 text-lg"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={c.quantity}
                    onChange={(e) => {
                      const q = Number(e.target.value.replace(",", "."));
                      if (Number.isFinite(q) && q >= 0) updateQty(c.product_id, q);
                    }}
                    className="h-8 w-14 rounded-lg border border-ink-300/30 bg-elev text-center text-[13px]"
                    aria-label="Кількість"
                  />
                  <button
                    type="button"
                    onClick={() => updateQty(c.product_id, c.quantity + 1)}
                    aria-label="Більше"
                    className="h-8 w-8 rounded-full bg-elev2 text-lg"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(c.product_id)}
                    aria-label="Видалити"
                    className="ml-1 h-8 w-8 rounded-full bg-elev2 text-sm text-brand-600"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* === comment === */}
      <div>
        <label htmlFor="comment" className="field-label">Коментар</label>
        <textarea
          id="comment"
          placeholder="Особливі побажання (необов'язково)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="field-textarea"
        />
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
          {error}
        </div>
      ) : null}

      {/* === quantity modal === */}
      {pendingItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qty-title"
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setPendingItem(null)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-elev p-4 shadow-soft sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3">
              <Thumb url={pendingItem.photo_url} />
              <div className="min-w-0">
                <p id="qty-title" className="truncate text-[14px] font-semibold text-ink-900">{pendingItem.name}</p>
                <p className="text-[11px] text-ink-500">{pendingItem.unit ?? "шт"}</p>
              </div>
            </div>
            <label htmlFor="pending-qty" className="field-label">Кількість</label>
            <input
              id="pending-qty"
              type="text"
              inputMode="decimal"
              autoFocus
              value={pendingQty}
              onChange={(e) => setPendingQty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmQty()}
              className="field-input mb-3"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setPendingItem(null)} className="btn-ghost flex-1">
                Скасувати
              </button>
              <button type="button" onClick={confirmQty} className="btn-primary flex-1">
                Підтвердити
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* === sticky submit bar === */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || cart.length === 0}
            className="btn-primary w-full"
          >
            {submitting ? "Відправляємо…" : `Відправити на склад · ${cartCount || 0}`}
          </button>
        </div>
      </div>
    </div>
  );
}
