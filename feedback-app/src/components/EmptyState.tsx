import type { ReactNode } from "react";

/**
 * A7: "what this is + why it's empty" instead of one small gray line of
 * text, used by every empty list/search result on the seller side.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mt-8 flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elev2 text-ink-300">
        {icon}
      </span>
      <p className="mt-3 text-headline text-ink-900">{title}</p>
      {subtitle ? <p className="mt-1 max-w-xs text-body text-ink-500">{subtitle}</p> : null}
    </div>
  );
}
