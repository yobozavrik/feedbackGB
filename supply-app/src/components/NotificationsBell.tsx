"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const POLL_MS = 60_000;

export function NotificationsBell() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/notifications?unread=1&limit=1");
        if (!r.ok) return;
        const j = (await r.json()) as { unread_count?: number };
        if (!cancelled) setUnread(j.unread_count ?? 0);
      } catch {
        // silent — bell is optional UI, never blocks the app
      }
    }
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Link
      href="/home/notifications"
      aria-label={unread ? `Сповіщення, непрочитаних: ${unread}` : "Сповіщення"}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-elev2"
    >
      <span aria-hidden>🔔</span>
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
