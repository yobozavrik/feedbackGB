import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
      <main>
        <header className="mb-4 pb-3 pt-1">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-xl">💖</span>
            <span className="font-display text-[19px] font-semibold tracking-tight grad-text">
              Галя слухає
            </span>
          </Link>
          <p className="mt-0.5 text-[12px] text-ink-500">Сторінку не знайдено</p>
        </header>
        <section className="card p-7 text-center">
          <div className="text-5xl">🌷</div>
          <h1 className="mt-3 font-display text-lg font-bold text-ink-900">
            Тут нічого немає
          </h1>
          <p className="mt-2 text-sm text-ink-700">
            Можливо, ви перейшли за застарілим посиланням.
          </p>
          <Link href="/" className="btn-primary mt-5">
            На головну
          </Link>
        </section>
      </main>
    </div>
  );
}
