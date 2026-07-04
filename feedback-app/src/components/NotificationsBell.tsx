"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 30_000;

export function NotificationsBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = () => {
      fetch("/api/notifications?unread=1&limit=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { unread_count?: number } | null) => {
          if (mountedRef.current && j) setUnreadCount(j.unread_count ?? 0);
        })
        .catch(() => {
          /* keep last known count */
        });
    };

    load();
    const interval = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      window.removeEventListener("focus", load);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label="Сповіщення"
      className="relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-lg hover:bg-elev2"
    >
      <span aria-hidden>🔔</span>
      {unreadCount > 0 ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
