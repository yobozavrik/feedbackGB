import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";

export function CategoryGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CATEGORIES.map((c, idx) => (
        <Link
          key={c.id}
          href={`/feedback/${c.id}`}
          className={`group relative flex h-[132px] animate-fade-up flex-col overflow-hidden rounded-2xl bg-elev p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98]`}
          style={{ animationDelay: `${idx * 40}ms` }}
        >
          {/* Tint overlay — soft, only bottom-right corner */}
          <div className={`absolute -bottom-8 -right-8 h-24 w-24 rounded-full ${c.gradient} blur-md`} />
          <div className="relative flex flex-col">
            <div className="text-[26px] leading-none">{c.emoji}</div>
            <h3 className="mt-2 font-display text-[15px] font-semibold leading-snug text-ink-900">
              {c.title}
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-500">
              {c.short}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
