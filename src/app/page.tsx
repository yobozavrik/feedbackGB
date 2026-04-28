import Link from "next/link";
import { Header } from "@/components/Header";
import { CategoryGrid } from "@/components/CategoryGrid";

export default function HomePage() {
  return (
    <main className="relative">
      <Header subtitle="Що сьогодні в магазині?" />

      <section className="card sparkles relative mb-5 overflow-hidden p-5">
        <p className="text-sm leading-relaxed text-ink-700">
          Розкажи менеджменту прямо: чого не вистачає на полицях, що клієнти
          просять і які ідеї крутяться в голові. Це допомагає швидше реагувати
          на реальну ситуацію в магазинах 🌸
        </p>
      </section>

      <h2 className="mb-3 px-1 font-display text-base font-semibold text-ink-900">
        Обери категорію
      </h2>
      <CategoryGrid />

      <div className="mt-6 flex items-center justify-between px-1 text-xs text-ink-500">
        <span>v1 • для команди Галя Балувана</span>
        <Link href="/admin" className="underline-offset-2 hover:underline">
          Звіт
        </Link>
      </div>
    </main>
  );
}
