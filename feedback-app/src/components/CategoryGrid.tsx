"use client";

import Link from "next/link";
import { useState } from "react";
import {
  getCategory,
  getSecondaryCategories,
  type Category,
} from "@/lib/categories";
import { track } from "@/lib/analytics";

/**
 * Main screen grid layout:
 * - "Продукція магазину" custom navigation card.
 * - "Заявка на ремонт" (tech_issue) priority card.
 * - "Заявка на розхідні матеріали" (consumables_request) priority card.
 * - Collapsed "+ Інше" section with secondary categories.
 */
export function CategoryGrid() {
  const techIssue = getCategory("tech_issue");
  const consumables = getCategory("consumables_request");
  const secondary = getSecondaryCategories();

  return (
    <div className="space-y-3">
      {/* 1. Products flow button */}
      <Link
        href="/products-menu"
        onClick={() => track("home_category_open", { category: "products_menu", section: "priority" })}
        className="group relative flex h-[118px] animate-fade-up items-center overflow-hidden rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
      >
        <div className="relative flex w-full items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[30px] leading-none text-brand-500">
            🛍️
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">
              Продукція магазину
            </h3>
            <p className="mt-1 text-[13px] leading-snug text-ink-500">
              Мало товару, багато товару, брак
            </p>
          </div>
          <span aria-hidden className="text-[22px] text-brand-500">
            →
          </span>
        </div>
      </Link>

      {/* 2. Repair request */}
      {techIssue && <PriorityCard c={techIssue} idx={1} />}

      {/* 3. Consumables request */}
      {consumables && <PriorityCard c={consumables} idx={2} />}

      {/* 4. HR questions flow button */}
      <Link
        href="/hr-menu"
        onClick={() => track("home_category_open", { category: "hr_menu", section: "priority" })}
        className="group relative flex h-[118px] animate-fade-up items-center overflow-hidden rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
        style={{ animationDelay: "180ms" }}
      >
        <div className="relative flex w-full items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[30px] leading-none text-brand-500">
            🧑‍💼
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">
              Питання по HR
            </h3>
            <p className="mt-1 text-[13px] leading-snug text-ink-500">
              Відпустка, вихідні, лікарняний, звільнення
            </p>
          </div>
          <span aria-hidden className="text-[22px] text-brand-500">
            →
          </span>
        </div>
      </Link>

      {/* 5. Secondary categories directly rendered in a 2-column grid */}
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1 animate-fade-up" style={{ animationDelay: "240ms" }}>
          {secondary.map((c) => (
            <SecondaryCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PriorityCard({ c, idx }: { c: Category; idx: number }) {
  return (
    <Link
      href={`/feedback/${c.id}`}
      onClick={() => track("home_category_open", { category: c.id, section: "priority" })}
      className="group relative flex h-[118px] animate-fade-up items-center overflow-hidden rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
      style={{ animationDelay: `${idx * 60}ms` }}
    >
      <div className="relative flex w-full items-center gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[30px] leading-none text-brand-500">
          {c.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">
            {c.title}
          </h3>
          <p className="mt-1 text-[13px] leading-snug text-ink-500">
            {c.short}
          </p>
        </div>
        <span aria-hidden className="text-[22px] text-brand-500">
          →
        </span>
      </div>
    </Link>
  );
}

function SecondaryCard({ c }: { c: Category }) {
  return (
    <Link
      href={`/feedback/${c.id}`}
      onClick={() => track("home_category_open", { category: c.id, section: "secondary" })}
      className="relative flex min-h-[168px] flex-col rounded-xl border border-ink-300/20 bg-elev p-3 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
    >
      <div className="relative flex flex-col">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-[20px] leading-none">
          {c.emoji}
        </div>
        <h4 className="mt-1.5 font-display text-[13px] font-semibold leading-tight text-ink-900">
          {c.title}
        </h4>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-500 line-clamp-2">
          {c.short}
        </p>
      </div>
    </Link>
  );
}
