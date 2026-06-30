"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductRow } from "@/app/api/products/route";

interface Props {
  open: boolean;
  storeId: number | null;
  onSelect: (product: ProductRow) => void;
  onClose: () => void;
}

interface CategoriesResponse {
  categories: Array<{
    id: string;
    name: string;
    sort_order: number;
    product_count: number;
  }>;
}

interface ProductsResponse {
  products: ProductRow[];
}

const POPULAR_LIMIT = 8;
const PAGE_SIZE = 500;

const cdnBase = (
  process.env.NEXT_PUBLIC_POSTER_CDN_BASE_URL ?? "https://joinposter.com"
).replace(/\/$/, "");

/**
 * Bottom-sheet product picker.
 * - Sticky search at top
 * - "Часто питають" chips (rolling 7-day usage in this store)
 * - Accordion of POS product groups, each lazy-rendered
 *
 * Loads ALL products once on open (PAGE_SIZE=500 covers our ~341-row catalog
 * with headroom). Search and category filtering are client-side, instant.
 */
export function ProductPicker({ open, storeId, onSelect, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allProducts, setAllProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoriesResponse["categories"]>([]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Load on first open. Re-fetch if storeId changes (popularity differs).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const productsUrl = new URL("/api/products", window.location.origin);
    productsUrl.searchParams.set("limit", String(PAGE_SIZE));
    if (storeId !== null) {
      productsUrl.searchParams.set("popular_for_store", String(storeId));
    }

    Promise.all([
      fetch(productsUrl.toString()).then(async (r) => {
        if (!r.ok) throw new Error("products");
        return (await r.json()) as ProductsResponse;
      }),
      fetch("/api/products/categories").then(async (r) => {
        if (!r.ok) throw new Error("categories");
        return (await r.json()) as CategoriesResponse;
      }),
    ])
      .then(([prodRes, catRes]) => {
        if (cancelled) return;
        setAllProducts(prodRes.products ?? []);
        setCategories(catRes.categories ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Не вдалось завантажити товари. Спробуй ще раз.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, storeId]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Auto-focus search after the sheet animates in
    const t = setTimeout(() => searchRef.current?.focus(), 200);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  const popular = useMemo(
    () =>
      allProducts
        .filter((p) => p.uses_7d > 0)
        .slice(0, POPULAR_LIMIT),
    [allProducts],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("uk");
    if (!needle) return allProducts;
    return allProducts.filter((p) =>
      p.name.toLocaleLowerCase("uk").includes(needle),
    );
  }, [allProducts, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, ProductRow[]>();
    for (const p of filtered) {
      const key = p.category_id ?? "__unknown";
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    return map;
  }, [filtered]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // While searching, auto-expand groups that have matches.
  const isSearching = q.trim().length > 0;
  const visibleGroups = useMemo(() => {
    if (!isSearching) return categories;
    return categories.filter((c) => (grouped.get(c.id)?.length ?? 0) > 0);
  }, [categories, grouped, isSearching]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Закрити"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Оберіть товар"
        className="absolute inset-x-0 bottom-0 top-10 flex flex-col rounded-t-3xl bg-bg shadow-2xl animate-slide-up sm:left-1/2 sm:max-w-md sm:-translate-x-1/2"
      >
        {/* Drag handle + header */}
        <div className="flex items-center justify-between border-b border-ink-300/20 px-4 pb-2 pt-3">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-ink-300/40" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full bg-elev2 px-3 py-1 text-[13px] font-medium text-ink-700"
          >
            Скасувати
          </button>
        </div>
        <div className="px-4 pb-3 pt-2">
          <h2 className="font-display text-[18px] font-semibold text-ink-900">
            Оберіть товар
          </h2>
        </div>

        {/* Search */}
        <div className="sticky top-0 z-10 border-b border-ink-300/15 bg-bg/95 px-4 pb-3 backdrop-blur">
          <input
            ref={searchRef}
            type="search"
            inputMode="search"
            placeholder="Пошук: молоко, пельмені, котлети…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="field-input"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {error ? (
            <div className="mt-4 rounded-lg border border-rose-300/40 bg-rose-50 px-4 py-3 text-[14px] text-rose-700">
              {error}
            </div>
          ) : null}

          {loading && allProducts.length === 0 ? (
            <div className="mt-4 space-y-3">
              <div className="skeleton h-7 w-32 rounded-full" />
              <div className="skeleton h-13 w-full rounded-2xl" />
              <div className="skeleton h-13 w-full rounded-2xl" />
              <div className="skeleton h-13 w-full rounded-2xl" />
            </div>
          ) : null}

          {/* Popular chips — only when not actively searching */}
          {!isSearching && popular.length > 0 ? (
            <section className="mt-4">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                Часто питають у цьому магазині
              </h3>
              <div className="flex flex-wrap gap-2">
                {popular.map((p) => (
                  <button
                    key={`pop-${p.id}`}
                    type="button"
                    onClick={() => onSelect(p)}
                    className="inline-flex items-center gap-2 rounded-full bg-cat-missing/40 px-3 py-1.5 text-[13px] font-medium text-ink-900 hover:bg-cat-missing/60 active:scale-[0.97]"
                  >
                    <span aria-hidden>🌿</span>
                    <span className="max-w-[200px] truncate">{p.name}</span>
                    {p.uses_7d > 1 ? (
                      <span className="text-[11px] text-ink-700">
                        ×{p.uses_7d}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* Grouped accordion */}
          <section className="mt-5">
            {visibleGroups.length === 0 && !loading && !error ? (
              <p className="py-8 text-center text-[14px] text-ink-500">
                Нічого не знайшли. Перевір орфографію або скасуй пошук.
              </p>
            ) : null}
            <ul className="space-y-2">
              {visibleGroups.map((g) => {
                const items = grouped.get(g.id) ?? [];
                const isOpen = openGroups.has(g.id) || isSearching;
                return (
                  <li
                    key={g.id}
                    className="overflow-hidden rounded-lg border border-ink-300/20 bg-elev"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="font-medium text-ink-900">
                        {g.name}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-[12px] text-ink-500">
                          {items.length}
                        </span>
                        <span
                          aria-hidden
                          className={`transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        >
                          ▾
                        </span>
                      </span>
                    </button>
                    {isOpen ? (
                      <ul className="border-t border-ink-300/15">
                        {items.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => onSelect(p)}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elev2 active:bg-elev2"
                            >
                              <ProductThumb photo={p.photo} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] font-medium text-ink-900">
                                  {p.name}
                                </span>
                                <span className="block text-[12px] text-ink-500">
                                  {p.unit ? p.unit : "шт"}
                                  {p.uses_7d > 0
                                    ? ` · ×${p.uses_7d} за 7 днів`
                                    : ""}
                                </span>
                              </span>
                              <span aria-hidden className="text-ink-300">
                                →
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProductThumb({ photo }: { photo: string | null }) {
  if (!photo) {
    return (
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-elev2 text-[18px]">
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
      className="h-10 w-10 flex-shrink-0 rounded-xl bg-elev2 object-cover"
      loading="lazy"
    />
  );
}
