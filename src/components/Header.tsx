import Link from "next/link";

export function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 bg-bg/85 px-4 pb-3 pt-1 backdrop-blur-md sm:-mx-6 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-2">
        <span className="text-xl">💖</span>
        <span className="font-display text-[19px] font-semibold tracking-tight grad-text">
          Галя слухає
        </span>
      </Link>
      {subtitle ? (
        <p className="mt-0.5 text-[12px] text-ink-500">{subtitle}</p>
      ) : null}
    </header>
  );
}
