import Link from "next/link";
import { Header } from "@/components/Header";

export default function NotFound() {
  return (
    <main>
      <Header subtitle="Сторінку не знайдено" />
      <section className="card p-7 text-center">
        <div className="text-5xl">🌷</div>
        <h1 className="mt-3 font-display text-lg font-bold text-ink-900">
          Тут нічого немає
        </h1>
        <p className="mt-2 text-sm text-ink-700">
          Можливо, ти перейшла за старим посиланням.
        </p>
        <Link href="/" className="btn-primary mt-5">
          На головну
        </Link>
      </section>
    </main>
  );
}
