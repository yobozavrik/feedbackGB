import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";

export function CategoryGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {CATEGORIES.map((c, idx) => (
        <Link
          key={c.id}
          href={`/feedback/${c.id}`}
          className={`group relative overflow-hidden rounded-3xl border border-white bg-gradient-to-br ${c.gradient} p-5 shadow-card transition hover:shadow-soft active:scale-[0.98]`}
          style={{ animationDelay: `${idx * 40}ms` }}
        >
          <div className="absolute -right-4 -top-4 text-7xl opacity-25 transition group-hover:scale-110">
            {c.emoji}
          </div>
          <div className="relative">
            <div className="mb-2 text-3xl">{c.emoji}</div>
            <h3 className="font-display text-base font-semibold text-ink-900">
              {c.title}
            </h3>
            <p className="mt-1 text-xs leading-snug text-ink-700/80">{c.short}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
