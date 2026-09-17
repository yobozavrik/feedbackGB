import Link from "next/link";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ChevronLeftIcon, InboxIcon } from "@/components/icons";

interface HeaderProps {
  subtitle?: string;
  back?: { href: string; label: string };
}

/**
 * Sticky page header. Shows the brand wordmark + an optional subtitle.
 *
 * If `back` is provided, a left-aligned "‹ <label>" link is rendered above
 * the brand to give the user an explicit way out of the current section.
 * (Mobile users can't always rely on browser-level back navigation —
 * especially when the app is launched as a PWA / from a Telegram WebView.)
 */
export function Header({ subtitle, back }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 -mx-[clamp(12px,4vw,20px)] mb-5 border-b border-ink-300/20 bg-bg/95 px-[clamp(12px,4vw,20px)] pb-3 pt-2 backdrop-blur-md">
      {back ? (
        <Link
          href={back.href}
          className="mb-1 inline-flex min-h-[44px] items-center gap-1 rounded-full pr-2 text-[14px] font-semibold text-brand-600 -ml-1 pl-1 hover:bg-elev2"
        >
          <ChevronLeftIcon size={18} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-center justify-between">
        {/* N2: a plain brand mark instead of the blue wordmark — the color
            is spent on buttons/links, not the logo. */}
        <Link href="/" className="inline-flex items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-base">
            🌸
          </span>
          <span className="font-display text-[18px] font-bold tracking-tight text-ink-900">
            Галя слухає
          </span>
        </Link>
        <div className="flex items-center">
          <Link href="/my-requests" aria-label="Мої заявки" className="btn-icon">
            <InboxIcon size={22} />
          </Link>
          <NotificationsBell />
        </div>
      </div>
      {subtitle ? (
        <p className="ml-11 mt-0.5 text-[14px] text-ink-700">{subtitle}</p>
      ) : null}
    </header>
  );
}
