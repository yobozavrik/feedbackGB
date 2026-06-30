import { cookies } from "next/headers";
import Link from "next/link";
import { Header } from "@/components/Header";
import { CategoryGrid } from "@/components/CategoryGrid";
import { LogoutButton } from "@/components/LogoutButton";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  const greeting = sess?.full_name ?? "колего";

  return (
    <main className="relative">
      <Header subtitle="Що сьогодні в магазині?" />

      {/* Hero speech-bubble */}
      <section className="relative mb-6 overflow-hidden rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 p-5 shadow-soft">
        <div className="pointer-events-none absolute -bottom-8 -right-8 h-28 w-28 rounded-full bg-white/10" />
        <p className="relative text-[15px] leading-relaxed text-white/90">
          Привіт,{" "}
          <span className="font-semibold text-white">{greeting}</span>{" "}
          <span aria-hidden>🌸</span> Розкажи менеджменту прямо: чого не вистачає
          на полицях, що клієнти просять і які ідеї крутяться в голові.
        </p>
      </section>

      <h2 className="mb-3 px-1 font-display text-[20px] font-bold text-ink-900">
        Обери категорію
      </h2>
      <CategoryGrid />

      <div className="mt-8 flex items-center justify-between px-1 text-[12px] text-ink-500">
        <span className="flex items-center gap-2">
          v1 • Галя Балувана
          {sess ? <LogoutButton /> : null}
        </span>
        {isAdminTier(sess?.role) ? (
          <Link
            href="/admin"
            className="rounded-full bg-brand-500 px-3 py-1 font-medium text-white shadow-soft transition-all hover:bg-brand-600 active:scale-95"
          >
            Звіт →
          </Link>
        ) : null}
      </div>
    </main>
  );
}
