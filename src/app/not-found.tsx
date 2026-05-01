import Link from "next/link";
import { Header } from "@/components/Header";

/**
 * Глобальна 404-сторінка. Лежить у корені `app/` (а не в route group),
 * щоб ловити невідомі URL-и в усіх частинах сайту — і Mini App, і адмінки.
 *
 * Свідомо рендерить власний `max-w-md` контейнер, бо корневий layout
 * (`src/app/layout.tsx`) сам не обмежує ширину (її задає `(app)/layout.tsx`).
 * Це означає, що навіть якщо адмін потрапить на `/admin/нонасуществующее`,
 * він побачить акуратну брендовану 404-ку, а не дефолтну Next.js-ну.
 */
export default function NotFound() {
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
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
    </div>
  );
}
