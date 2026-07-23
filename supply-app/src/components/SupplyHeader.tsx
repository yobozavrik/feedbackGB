import Link from "next/link";

interface Props {
  subtitle?: string;
  back?: { href: string; label: string };
}

/** Sticky page header for supply screens. No Telegram/notifications coupling. */
export function SupplyHeader({ subtitle, back }: Props) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-5 border-b border-ink-300/20 bg-bg/95 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6">
      {back ? (
        <Link
          href={back.href}
          className="mb-2 inline-flex h-9 items-center gap-1 rounded-full px-2 text-[12px] font-semibold text-brand-500 hover:bg-elev2"
        >
          <span aria-hidden>←</span>
          {back.label}
        </Link>
      ) : null}
      <Link href="/home" className="inline-flex items-center gap-3">
        <span className="text-xl" aria-hidden>🏭</span>
        <span className="font-display text-[20px] font-bold tracking-tight text-brand-500">
          Галя: Цех і склад
        </span>
      </Link>
      {subtitle ? <p className="ml-8 mt-0.5 text-[13px] text-ink-500">{subtitle}</p> : null}
    </header>
  );
}
