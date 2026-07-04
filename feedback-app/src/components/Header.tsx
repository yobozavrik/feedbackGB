import Link from "next/link";
import { NotificationsBell } from "@/components/NotificationsBell";

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
      <div className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-3">
          <span className="text-xl">💖</span>
          <span className="font-display text-[20px] font-bold tracking-tight text-brand-500">
            Галя слухає
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/my-requests"
            aria-label="Мої заявки"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-lg hover:bg-elev2"
          >
            <span aria-hidden>🗂️</span>
          </Link>
          <NotificationsBell />
        </div>
      </div>
      {subtitle ? (
        <p className="ml-8 mt-0.5 text-[13px] text-ink-500">{subtitle}</p>
      ) : null}
    </header>
  );
}
