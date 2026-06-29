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
  const [expanded, setExpanded] = useState(false);
  const techIssue = getCategory("tech_issue");
  const consumables = getCategory("consumables_request");
  const secondary = getSecondaryCategories();

  return (
    <div className="space-y-3">
      {/* 1. Products flow button */}
      <Link
        href="/products-menu"
        onClick={() => track("home_category_open", { category: "products_menu", section: "priority" })}
        className="group relative flex h-[120px] animate-fade-up items-center overflow-hidden rounded-3xl bg-elev p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      >
        <div className="absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-cat-overstock/40 blur-md" />
        <div className="relative flex w-full items-center gap-4">
          <div className="text-[44px] leading-none">🛍️</div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">
              Продукція магазину
            </h3>
            <p className="mt-1 text-[13px] leading-snug text-ink-500">
              Мало товару, багато товару, брак
            </p>
          </div>
          <span aria-hidden className="text-[22px] text-ink-300 group-hover:text-brand-500">
            →
          </span>
        </div>
      </Link>

      {/* 2. Repair request */}
      {techIssue && <PriorityCard c={techIssue} idx={1} />}

      {/* 3. Consumables request */}
      {consumables && <PriorityCard c={consumables} idx={2} />}

      {/* Secondary dropdown */}
      {secondary.length > 0 ? (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between rounded-2xl bg-elev px-4 py-3 text-left text-[14px] font-medium text-ink-700 hover:bg-elev2"
          >
            <span>+ Інше</span>
            <span aria-hidden className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {expanded ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {secondary.map((c) => (
                <SecondaryCard key={c.id} c={c} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PriorityCard({ c, idx }: { c: Category; idx: number }) {
  return (
    <Link
      href={`/feedback/${c.id}`}
      onClick={() => track("home_category_open", { category: c.id, section: "priority" })}
      className="group relative flex h-[120px] animate-fade-up items-center overflow-hidden rounded-3xl bg-elev p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      style={{ animationDelay: `${idx * 60}ms` }}
    >
      <div className={`absolute -bottom-12 -right-12 h-40 w-40 rounded-full ${c.gradient} blur-md`} />
      <div className="relative flex w-full items-center gap-4">
        <div className="text-[44px] leading-none">{c.emoji}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] font-semibold leading-tight text-ink-900">
            {c.title}
          </h3>
          <p className="mt-1 text-[13px] leading-snug text-ink-500">
            {c.short}
          </p>
        </div>
        <span aria-hidden className="text-[22px] text-ink-300 group-hover:text-brand-500">
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
      className="relative flex h-[100px] flex-col overflow-hidden rounded-2xl bg-elev p-3 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <div className={`absolute -bottom-8 -right-8 h-24 w-24 rounded-full ${c.gradient} blur-md`} />
      <div className="relative flex flex-col">
        <div className="text-[22px] leading-none">{c.emoji}</div>
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
