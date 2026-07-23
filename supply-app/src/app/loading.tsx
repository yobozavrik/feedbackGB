export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
      <div className="flex items-center gap-3 text-ink-500">
        <span className="h-3 w-3 animate-pulse-soft rounded-full bg-brand-500" aria-hidden />
        <span className="text-[14px]">Завантаження…</span>
      </div>
    </main>
  );
}
