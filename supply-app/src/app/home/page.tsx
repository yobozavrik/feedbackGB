import Link from "next/link";
import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHomeGrid } from "@/components/SupplyHomeGrid";

export const dynamic = "force-dynamic";

export default async function SupplyHomePage() {
  const user = await requireSupplyUser();

  return (
    <main className="relative">
      <header className="sticky top-0 z-10 -mx-4 mb-5 border-b border-ink-300/20 bg-bg/95 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between">
          <Link href="/home" className="inline-flex items-center gap-3">
            <span className="text-xl" aria-hidden>🏭</span>
            <span className="font-display text-[20px] font-bold tracking-tight text-brand-500">Галя: Цех і склад</span>
          </Link>
        </div>
        {user.facilityName ? (
          <p className="mt-0.5 text-[13px] text-ink-500">{user.facilityName}</p>
        ) : null}
      </header>

      <section className="relative mb-6 overflow-hidden rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 p-5 shadow-soft">
        <div className="pointer-events-none absolute -bottom-8 -right-8 h-28 w-28 rounded-full bg-white/10" />
        <p className="relative text-[15px] leading-relaxed text-white/90">
          Привіт, <span className="font-semibold text-white">{user.name}</span>. Обери, що потрібно: замовити сировину, зафіксувати брак або додати прихідну накладну.
        </p>
      </section>

      <h2 className="mb-3 px-1 font-display text-[20px] font-bold text-ink-900">Що потрібно зробити?</h2>
      <SupplyHomeGrid />

      <div className="mt-8 flex items-center justify-between px-1 text-[12px] text-ink-500">
        <span className="flex items-center gap-2">v1 • Галя: Цех і склад</span>
        <form action="/api/auth/logout" method="post">
          <button className="rounded-full px-2 py-0.5 underline-offset-2 hover:underline">вийти</button>
        </form>
      </div>
    </main>
  );
}
