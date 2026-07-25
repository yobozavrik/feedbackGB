"use client";

import { useState } from "react";
import { useCart } from "./CartContext";

const UNIT_LABEL: Record<string, string> = {
  kg: "кг",
  liter: "л",
  piece: "шт",
};

export interface CategoryIngredient {
  id: string;
  name: string;
  unit: string;
  photoUrl: string | null;
}

export function CategoryIngredientList({ ingredients }: { ingredients: CategoryIngredient[] }) {
  const cart = useCart();
  const [active, setActive] = useState<CategoryIngredient | null>(null);
  const [quantity, setQuantity] = useState(1);

  function openModal(item: CategoryIngredient) {
    setActive(item);
    setQuantity(cart.getQuantity(item.id) || 1);
  }

  function confirm() {
    if (!active) return;
    cart.upsertItem({
      ingredientId: active.id,
      name: active.name,
      unit: UNIT_LABEL[active.unit] ?? active.unit,
      quantity,
    });
    setActive(null);
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-ink-300/20 bg-elev shadow-soft">
        {ingredients.map((item) => {
          const inCart = cart.getQuantity(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openModal(item)}
              className="flex h-14 w-full items-center gap-3 border-b border-ink-300/20 px-4 text-left last:border-b-0 active:bg-elev2"
            >
              {item.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- pre-signed Storage URL, batch-generated server-side
                <img src={item.photoUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-md object-cover" />
              ) : (
                <span className="h-9 w-9 flex-shrink-0 rounded-md bg-elev2" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-[15px] text-ink-900">{item.name}</span>
              {inCart > 0 ? (
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-semibold text-brand-600">
                  {formatQty(inCart)} {UNIT_LABEL[item.unit] ?? item.unit}
                </span>
              ) : (
                <span className="whitespace-nowrap text-[13px] text-ink-500">{UNIT_LABEL[item.unit] ?? item.unit}</span>
              )}
            </button>
          );
        })}
      </div>

      {active ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setActive(null)}>
          <div
            className="w-full animate-fade-up rounded-t-2xl bg-elev p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-3">
              {active.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={active.photoUrl} alt="" className="h-12 w-12 flex-shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="h-12 w-12 flex-shrink-0 rounded-lg bg-elev2" aria-hidden />
              )}
              <span className="min-w-0 flex-1 text-[17px] font-semibold text-ink-900">{active.name}</span>
            </div>

            <label className="field-label">Кількість ({UNIT_LABEL[active.unit] ?? active.unit})</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Менше"
                className="btn-step"
                onClick={() => setQuantity((q) => Math.max(0.001, Math.round((q - 1) * 1000) / 1000))}
              >
                −
              </button>
              <input
                inputMode="decimal"
                aria-label="Кількість"
                className="field-input h-[52px] flex-1 text-center text-[20px] font-semibold tabular-nums"
                value={String(quantity)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(",", "."));
                  if (!Number.isNaN(n)) setQuantity(n);
                }}
              />
              <button
                type="button"
                aria-label="Більше"
                className="btn-step"
                onClick={() => setQuantity((q) => Math.round((q + 1) * 1000) / 1000)}
              >
                +
              </button>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setActive(null)} className="btn-ghost px-4">
                Скасувати
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!(quantity > 0)}
                className="btn-primary flex-1"
              >
                Додати в кошик
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
