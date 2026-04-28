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

      <section className="card sparkles relative mb-5 overflow-hidden p-5">
        <p className="text-sm leading-relaxed text-ink-700">
          Привіт, <span className="font-semibold">{greeting}</span> 🌸 Розкажи
          менеджменту прямо: чого не вистачає на полицях, що клієнти просять і
          які ідеї крутяться в голові.
        </p>
      </section>

      <h2 className="mb-3 px-1 font-display text-base font-semibold text-ink-900">
        Обери категорію
      </h2>
      <CategoryGrid />

      <div className="mt-6 flex items-center justify-between px-1 text-xs text-ink-500">
        <span className="flex items-center gap-2">
          v1 • для команди Галя Балувана
          {sess ? <LogoutButton /> : null}
        </span>
        {sess?.role === "admin" ? (
          <Link href="/admin" className="underline-offset-2 hover:underline">
            Звіт
          </Link>
        ) : null}
      </div>
    </main>
  );
}
