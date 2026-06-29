import { Header } from "@/components/Header";
import { PriorityCard } from "@/components/CategoryGrid";
import { getCategory } from "@/lib/categories";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProductsMenuPage() {
  const missing = getCategory("missing_item");
  const overstock = getCategory("overstock");
  const defect = getCategory("defect");

  const categories = [missing, overstock, defect].filter(Boolean);

  return (
    <main className="relative">
      <Header subtitle="Опиши проблему з товаром" back={{ href: "/", label: "Назад" }} />

      <h2 className="mb-4 px-1 font-display text-[15px] font-semibold text-ink-900">
        Обери категорію проблеми
      </h2>

      <div className="space-y-3">
        {categories.map((c, idx) => (
          // c is non-null because we filtered Boolean
          <PriorityCard key={c!.id} c={c!} idx={idx} />
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between px-1 text-[12px] text-ink-500">
        <span>v1 • Галя Балувана</span>
        <Link
          href="/"
          className="rounded-full bg-elev px-3 py-1 font-medium text-ink-700 shadow-soft transition-all hover:bg-elev2 active:scale-95"
        >
          Головна
        </Link>
      </div>
    </main>
  );
}
