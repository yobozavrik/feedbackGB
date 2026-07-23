import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 text-5xl" aria-hidden>🧭</div>
      <h1 className="font-display text-[22px] font-bold text-ink-900">Сторінку не знайдено</h1>
      <p className="mt-2 text-[14px] text-ink-500">Такої сторінки немає або вона ще не готова.</p>
      <Link
        href="/home"
        className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand-500 px-6 font-medium text-white transition-all hover:bg-brand-600 active:scale-[0.97]"
      >
        На головну
      </Link>
    </main>
  );
}
