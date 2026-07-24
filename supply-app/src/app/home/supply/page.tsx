import Image from "next/image";
import Link from "next/link";
import { requireSupplyUser } from "@/lib/currentUser";

const actions: Array<[string, string, string]> = [
  ["Прихідні накладні", "Додати прихідну накладну", "🧾"],
  ["Проблема з постачанням", "Привезли не те / зіпсоване / запізно", "📦"],
];

export default async function SupplySectionPage() {
  await requireSupplyUser();

  return (
    <main>
      <Link
        href="/home"
        className="mb-5 inline-flex h-9 items-center rounded-full px-2 text-[12px] font-semibold text-brand-500 hover:bg-elev2"
      >
        ← Назад
      </Link>
      <h1 className="mb-4 font-display text-[22px] font-bold text-ink-900">Сировина для цеху</h1>

      <div
        role="status"
        className="mb-4 rounded-xl border border-brand-500/30 bg-brand-50/60 p-4 text-[13px] leading-relaxed text-ink-700"
      >
        <p className="font-semibold text-ink-900">Модуль ще в підготовці</p>
        <p className="mt-1">
          Форма прихідних накладних увімкнеться після застосування Supply-міграції та підтвердженого
          CRM-контракту. Зараз система не показує тестових або вигаданих документів.
        </p>
      </div>

      <div className="space-y-3">
        <Link
          href="/home/supply/order"
          className="group flex h-[118px] items-center rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft transition-all hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
        >
          <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-brand-50">
            <Image src="/raw-materials/dry-goods.png" alt="" fill sizes="48px" className="object-cover mix-blend-multiply" />
          </div>
          <div className="ml-4 flex-1">
            <h2 className="font-display text-[19px] font-semibold text-ink-900">Замовлення сировини</h2>
            <p className="mt-1 text-[13px] text-ink-500">Створити заявку на потрібну сировину</p>
          </div>
          <span aria-hidden className="text-[22px] text-brand-500">→</span>
        </Link>

        <Link
          href="/home/feedback/raw_material_defect"
          className="group flex h-[118px] items-center rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft transition-all hover:-translate-y-0.5 active:scale-[0.98] active:bg-elev2"
        >
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[30px] leading-none">
            💔
          </div>
          <div className="ml-4 flex-1">
            <h2 className="font-display text-[19px] font-semibold text-ink-900">Брак сировини</h2>
            <p className="mt-1 text-[13px] text-ink-500">Зафіксувати брак сировини</p>
          </div>
          <span aria-hidden className="text-[22px] text-brand-500">→</span>
        </Link>

        {actions.map(([title, description, emoji]) => (
          <div
            key={title}
            aria-disabled="true"
            className="flex h-[118px] cursor-not-allowed items-center rounded-xl border border-ink-300/20 bg-elev p-4 opacity-60 shadow-soft"
          >
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-elev2 text-[30px] grayscale">
              {emoji}
            </div>
            <div className="ml-4 flex-1">
              <h2 className="font-display text-[19px] font-semibold text-ink-900">{title}</h2>
              <p className="mt-1 text-[13px] text-ink-500">{description}</p>
            </div>
            <span className="rounded-full bg-elev2 px-2 py-0.5 text-[11px] font-medium text-ink-500">скоро</span>
          </div>
        ))}
      </div>
    </main>
  );
}
