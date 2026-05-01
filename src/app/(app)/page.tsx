import { cookies } from "next/headers";
import Link from "next/link";
import { Header } from "@/components/Header";
import { CategoryGrid } from "@/components/CategoryGrid";
import { LogoutButton } from "@/components/LogoutButton";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  const greeting = sess?.full_name ?? "колего";

  return (
    <main className="relative">
      <Header subtitle="Що сьогодні в магазині?" />

      {/* Hero speech-bubble */}
      <section className="card relative mb-5 p-5">
        <div className="absolute -left-1.5 bottom-3 h-4 w-4 rotate-45 bg-elev shadow-soft" />
        <p className="text-[14px] leading-relaxed text-ink-700">
          Привіт,{" "}
          <span className="font-semibold text-ink-900">{greeting}</span>{" "}
          <span aria-hidden>🌸</span> Розкажи менеджменту прямо: чого не вистачає
          на полицях, що клієнти просять і які ідеї крутяться в голові.
        </p>
      </section>

      <h2 className="mb-3 px-1 font-display text-[15px] font-semibold text-ink-900">
        Обери категорію
      </h2>
      <CategoryGrid />

      <div className="mt-8 flex items-center justify-between px-1 text-[12px] text-ink-500">
        <span className="flex items-center gap-2">
          v1 • Галя Балувана
          {sess ? <LogoutButton /> : null}
        </span>
        {sess?.role === "admin" ? (
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
