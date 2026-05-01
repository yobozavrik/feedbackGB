import Link from "next/link";

interface HeaderProps {
  subtitle?: string;
  back?: { href: string; label: string };
}

/**
 * Sticky page header. Shows the brand wordmark + an optional subtitle.
 *
 * If `back` is provided, a left-aligned "← <label>" link is rendered above
 * the brand to give the user an explicit way out of the current section.
 * (Mobile users can't always rely on browser-level back navigation —
 * especially when the app is launched as a PWA / from a Telegram WebView.)
 */
export function Header({ subtitle, back }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 bg-bg/85 px-4 pb-3 pt-1 backdrop-blur-md sm:-mx-6 sm:px-6">
      {back ? (
        <Link
          href={back.href}
          className="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-ink-500 hover:text-ink-900"
        >
          <span aria-hidden>←</span>
          {back.label}
        </Link>
      ) : null}
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
