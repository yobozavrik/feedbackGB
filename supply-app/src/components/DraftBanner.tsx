"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface DraftRow {
  id: string;
  cart_items: Array<{ product_id: number; quantity: number }>;
  comment: string | null;
  updated_at: string;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `сьогодні ${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mo} ${hh}:${mm}`;
}

/**
 * Shows the caller's active consumables draft above the Активні/Архів tabs
 * when it has at least one item. Silent when the draft is empty or absent —
 * the "Мої заявки" screen already has an empty state for that.
 */
export function DraftBanner() {
  const [draft, setDraft] = useState<DraftRow | null>(null);

  useEffect(() => {
    fetch("/api/drafts/consumables")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { draft: DraftRow } | null) => {
        if (j?.draft && Array.isArray(j.draft.cart_items) && j.draft.cart_items.length > 0) {
          setDraft(j.draft);
        }
      })
      .catch(() => {
        // silent — banner is optional UI
      });
  }, []);

  if (!draft) return null;

  const count = draft.cart_items.length;
  const totalQty = draft.cart_items.reduce((n, c) => n + c.quantity, 0);

  return (
    <Link
      href="/home/feedback/consumables_request"
      className="mb-4 flex items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-50 p-3 shadow-soft transition-all hover:-translate-y-0.5 active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500 text-lg text-white" aria-hidden>
        ✏️
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-brand-600">Чернетка: розхідні матеріали</p>
        <p className="text-[12px] text-ink-500">
          {count} позиц. · {totalQty} шт · оновлено {fmtWhen(draft.updated_at)}
        </p>
      </div>
      <span aria-hidden className="text-[20px] text-brand-500">→</span>
    </Link>
  );
}
