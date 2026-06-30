"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "feedback-gb:store_id";

interface Store {
  id: number;
  name: string;
}

interface Props {
  /** name of the hidden numeric input that carries store_id (or empty) */
  name?: string;
  /** Optional callback fired when the user picks (or clears) a store. */
  onChange?: (storeId: number | null, storeLabel: string) => void;
}

/**
 * Searchable store selector for admins (sellers see a read-only chip instead).
 *
 * Pulls /api/stores (server-cached, joined to ERP categories.spots) and
 * remembers the last picked store_id in localStorage.
 */
export function StoreSelect({ name = "store_id", onChange }: Props) {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/stores", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j?.stores) && j.stores.length) setStores(j.stores);
      })
      .catch(() => {});
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n)) setStoreId(n);
    }
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (typeof storeId === "number") {
      window.localStorage.setItem(STORAGE_KEY, String(storeId));
    }
  }, [storeId]);

  const selected = useMemo(
    () => stores.find((s) => s.id === storeId) ?? null,
    [stores, storeId],
  );

  useEffect(() => {
    if (!onChange) return;
    onChange(storeId, selected?.name ?? "");
  }, [storeId, selected, onChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores.slice(0, 8);
    return stores.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [stores, query]);

  return (
    <div className="relative">
      <label className="field-label">Магазин</label>
      {selected ? (
        <div className="flex items-center gap-2">
          <span className="pill bg-cat-missing/40 text-ink-900">
            <span aria-hidden>📍</span>
            {selected.name}
          </span>
          <button
            type="button"
            onClick={() => {
              setStoreId(null);
              setOpen(true);
            }}
            className="text-[12px] text-ink-500 underline-offset-2 hover:underline"
          >
            змінити
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            className="field-input"
            placeholder="🔍 Знайти магазин"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
          />
          {open && filtered.length > 0 ? (
            <ul className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-ink-300/30 bg-elev shadow-soft">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setStoreId(s.id);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="block w-full px-4 py-2.5 text-left text-[14px] text-ink-900 hover:bg-elev2"
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <input type="hidden" name={name} value={storeId ?? ""} />
      <input type="hidden" name="store_label" value="" />
    </div>
  );
}
