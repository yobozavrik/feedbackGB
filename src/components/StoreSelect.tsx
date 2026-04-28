"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "feedback-gb:store";

const STORES = [
  "Не вказувати",
  "Магазин №1",
  "Магазин №2",
  "Магазин №3",
  "Магазин №4",
  "Магазин №5",
  "Інший",
];

export function StoreSelect({
  name = "store",
  defaultValue,
}: {
  name?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState<string>(defaultValue ?? "Не вказувати");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && !defaultValue) setValue(saved);
  }, [defaultValue]);

  useEffect(() => {
    if (value && value !== "Не вказувати" && value !== "Інший") {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  }, [value]);

  const submitted =
    value === "Інший" ? custom.trim() : value === "Не вказувати" ? "" : value;

  return (
    <div>
      <label className="field-label">Магазин</label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {STORES.map((s) => {
          const active = value === s;
          return (
            <button
              type="button"
              key={s}
              onClick={() => setValue(s)}
              className={`rounded-xl border px-2.5 py-2 text-xs font-medium transition ${
                active
                  ? "border-blush-300 bg-blush-100 text-blush-600 shadow-soft"
                  : "border-ink-300/30 bg-white/70 text-ink-700 hover:bg-white"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
      {value === "Інший" ? (
        <input
          type="text"
          className="field-input mt-2"
          placeholder="Назва магазину"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      ) : null}
      <input type="hidden" name={name} value={submitted} />
    </div>
  );
}
