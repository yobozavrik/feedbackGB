"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPinIcon, SearchIcon } from "@/components/icons";

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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-elev2 px-3 py-1.5 text-[14px] font-medium text-ink-900">
            <MapPinIcon size={16} className="text-ink-500" />
            {selected.name}
          </span>
          <button
            type="button"
            onClick={() => {
              setStoreId(null);
              setOpen(true);
            }}
            className="link"
          >
            змінити
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              type="text"
              className="field-input pl-11"
              placeholder="Знайти магазин"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
            />
          </div>
          {open && filtered.length > 0 ? (
            <ul className="mt-1 max-h-60 overflow-y-auto rounded-app border border-ink-300/30 bg-elev shadow-soft">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setStoreId(s.id);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="flex min-h-[44px] w-full items-center px-4 text-left text-[14px] text-ink-900 hover:bg-elev2"
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
