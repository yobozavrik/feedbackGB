"use client";

import Link from "next/link";
import {
  getCategory,
  getSecondaryCategories,
  type Category,
} from "@/lib/categories";
import { track } from "@/lib/analytics";
import { ChevronRightIcon } from "@/components/icons";
import { CATEGORY_TINT_BG } from "@/lib/categoryTint";

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
  const photoReport = getCategory("photo_report");
  const secondary = getSecondaryCategories();

  return (
    <div className="space-y-3">
      {/* 1. Products flow button */}
      <Link
        href="/products-menu"
        onClick={() => track("home_category_open", { category: "products_menu", section: "priority" })}
        className="group relative flex min-h-[80px] animate-fade-up items-center rounded-card border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 active:scale-[0.985] active:bg-elev2 [@media(hover:hover)]:hover:-translate-y-0.5"
      >
        <div className="relative flex w-full items-center gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-cat-missing text-[26px] leading-none">
            🛍️
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[17px] font-bold leading-tight text-ink-900">
              Продукція магазину
            </h3>
            <p className="mt-0.5 text-body leading-snug text-ink-700">
              Мало товару, багато товару, брак
            </p>
          </div>
          <ChevronRightIcon size={20} className="flex-shrink-0 text-ink-500" />
        </div>
      </Link>

      {/* 2. Repair request */}
      {techIssue && <PriorityCard c={techIssue} idx={1} />}

      {/* 3. Consumables request */}
      {consumables && <PriorityCard c={consumables} idx={2} />}

      {/* 4. Daily photo report */}
      {photoReport && <PriorityCard c={photoReport} idx={3} />}

      {/* 5. HR questions flow button */}
      <Link
        href="/hr-menu"
        onClick={() => track("home_category_open", { category: "hr_menu", section: "priority" })}
        className="group relative flex min-h-[80px] animate-fade-up items-center rounded-card border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 active:scale-[0.985] active:bg-elev2 [@media(hover:hover)]:hover:-translate-y-0.5"
        style={{ animationDelay: "160ms" }}
      >
        <div className="relative flex w-full items-center gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-cat-hr text-[26px] leading-none">
            🧑‍💼
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[17px] font-bold leading-tight text-ink-900">
              Питання до HR
            </h3>
            <p className="mt-0.5 text-body leading-snug text-ink-700">
              Відпустка, вихідні, лікарняний, звільнення
            </p>
          </div>
          <ChevronRightIcon size={20} className="flex-shrink-0 text-ink-500" />
        </div>
      </Link>

      {/* 6. Secondary categories directly rendered in a 2-column grid */}
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1 animate-fade-up" style={{ animationDelay: "200ms" }}>
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
      className="group relative flex min-h-[80px] animate-fade-up items-center rounded-card border border-ink-300/20 bg-elev p-4 shadow-soft transition-all duration-200 active:scale-[0.985] active:bg-elev2 [@media(hover:hover)]:hover:-translate-y-0.5"
      style={{ animationDelay: `${idx * 40}ms` }}
    >
      <div className="relative flex w-full items-center gap-4">
        <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] ${CATEGORY_TINT_BG[c.tint]} text-[26px] leading-none`}>
          {c.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[17px] font-bold leading-tight text-ink-900">
            {c.title}
          </h3>
          <p className="mt-0.5 text-body leading-snug text-ink-700">
            {c.short}
          </p>
        </div>
        <ChevronRightIcon size={20} className="flex-shrink-0 text-ink-500" />
      </div>
    </Link>
  );
}

function SecondaryCard({ c }: { c: Category }) {
  return (
    <Link
      href={`/feedback/${c.id}`}
      onClick={() => track("home_category_open", { category: c.id, section: "secondary" })}
      className="relative flex min-h-[112px] flex-col rounded-card border border-ink-300/20 bg-elev p-3 shadow-soft transition-all duration-200 active:scale-[0.985] active:bg-elev2 [@media(hover:hover)]:hover:-translate-y-0.5"
    >
      <div className="relative flex min-w-0 flex-col">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${CATEGORY_TINT_BG[c.tint]} text-[20px] leading-none`}>
          {c.emoji}
        </div>
        <h4 className="mt-2 font-display text-[14px] font-semibold leading-tight text-ink-900">
          {c.title}
        </h4>
        <p className="mt-0.5 text-meta leading-snug text-ink-500 line-clamp-2">
          {c.short}
        </p>
      </div>
    </Link>
  );
}
