"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "feedback-gb:store_id";

interface Store {
  id: number;
  name: string;
}

interface Props {
  /** name of the hidden numeric input that carries store_id (or empty) */
  name?: string;
}

/**
 * Quick-pick chips for "which shop am I in".
 *
 * Loads `/api/stores` (cached on the server). If nothing comes back we fall
 * back to the placeholder Магазин №1-5 so the form always works.
 *
 * Remembers the last picked store_id in localStorage so a sales-rep working
 * the same shop all day doesn't re-tap on every fb.
 */
export function StoreSelect({ name = "store_id" }: Props) {
  const [stores, setStores] = useState<Store[]>([
    { id: 1, name: "Магазин №1" },
    { id: 2, name: "Магазин №2" },
    { id: 3, name: "Магазин №3" },
    { id: 4, name: "Магазин №4" },
    { id: 5, name: "Магазин №5" },
  ]);
  const [storeId, setStoreId] = useState<number | "other" | null>(null);
  const [custom, setCustom] = useState("");

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

  const submitId = typeof storeId === "number" ? String(storeId) : "";
  const submitLabel = storeId === "other" ? custom.trim() : "";

  return (
    <div>
      <label className="field-label">Магазин</label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setStoreId(null)}
          className={chipClass(storeId === null)}
        >
          Не вказувати
        </button>
        {stores.map((s) => (
          <button
            type="button"
            key={s.id}
            onClick={() => setStoreId(s.id)}
            className={chipClass(storeId === s.id)}
          >
            {s.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setStoreId("other")}
          className={chipClass(storeId === "other")}
        >
          Інший
        </button>
      </div>
      {storeId === "other" ? (
        <input
          type="text"
          className="field-input mt-2"
          placeholder="Назва магазину"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      ) : null}
      <input type="hidden" name={name} value={submitId} />
      <input type="hidden" name="store_label" value={submitLabel} />
    </div>
  );
}

function chipClass(active: boolean) {
  return `rounded-xl border px-2.5 py-2 text-xs font-medium transition ${
    active
      ? "border-blush-300 bg-blush-100 text-blush-600 shadow-soft"
      : "border-ink-300/30 bg-white/70 text-ink-700 hover:bg-white"
  }`;
}
