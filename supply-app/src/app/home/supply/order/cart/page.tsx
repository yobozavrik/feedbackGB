"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/components/raw-materials/CartContext";

export default function RawMaterialsCartPage() {
  const router = useRouter();
  const cart = useCart();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (cart.items.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/supply/raw-materials/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.items.map((i) => ({ ingredient_id: i.ingredientId, quantity: i.quantity })),
          comment: comment.trim() || null,
          client_submission_id: crypto.randomUUID(),
          client_created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Не вдалося відправити заявку");
      }
      cart.clear();
      router.push("/home/thanks?cat=raw_material_order");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setBusy(false);
    }
  }

  return (
    <main className="pb-24">
      <Link
        href="/home/supply/order"
        className="mb-5 inline-flex h-9 items-center rounded-full px-2 text-[12px] font-semibold text-brand-500 hover:bg-elev2"
      >
        ← Продовжити вибір
      </Link>
      <h1 className="mb-4 font-display text-[22px] font-bold text-ink-900">Кошик</h1>

      {cart.items.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-300/40 bg-elev px-6 py-12 text-center shadow-soft">
          <span className="mb-3 text-[32px]" aria-hidden>🧺</span>
          <p className="max-w-[280px] text-[15px] text-ink-700">Кошик порожній — обери категорію і додай сировину</p>
          <Link href="/home/supply/order" className="btn-primary mt-5">
            До категорій
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {cart.items.map((item) => (
              <div
                key={item.ingredientId}
                className="flex items-center gap-3 rounded-xl border border-ink-300/20 bg-elev p-3 shadow-soft"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink-900">{item.name}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Менше"
                    className="btn-step h-9 w-9 text-[18px]"
                    onClick={() =>
                      cart.upsertItem({ ...item, quantity: Math.round((item.quantity - 1) * 1000) / 1000 })
                    }
                  >
                    −
                  </button>
                  <span className="w-14 text-center text-[14px] font-semibold tabular-nums text-ink-900">
                    {formatQty(item.quantity)} {item.unit}
                  </span>
                  <button
                    type="button"
                    aria-label="Більше"
                    className="btn-step h-9 w-9 text-[18px]"
                    onClick={() =>
                      cart.upsertItem({ ...item, quantity: Math.round((item.quantity + 1) * 1000) / 1000 })
                    }
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Видалити"
                  onClick={() => cart.removeItem(item.ingredientId)}
                  className="ml-1 h-9 w-9 flex-shrink-0 rounded-lg text-[16px] text-ink-500 hover:bg-elev2"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label htmlFor="comment" className="field-label">
              Коментар для складу (необов&apos;язково)
            </label>
            <textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              placeholder="Наприклад: терміново, до обіду"
              className="field-textarea"
            />
          </div>

          {error ? (
            <div role="alert" className="mt-4 rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
              {error}
            </div>
          ) : null}

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
            <div className="mx-auto flex max-w-md gap-2">
              <button type="button" onClick={() => router.back()} className="btn-ghost px-4">
                Назад
              </button>
              <button type="button" onClick={onSubmit} disabled={busy} className="btn-primary flex-1">
                {busy ? "Відправляємо…" : "Відправити заявку"}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
