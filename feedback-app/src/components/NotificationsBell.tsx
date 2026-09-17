"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellIcon } from "@/components/icons";

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
    <Link href="/notifications" aria-label="Сповіщення" className="btn-icon relative">
      <BellIcon size={22} />
      {unreadCount > 0 ? (
        <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[12px] font-bold leading-none text-white ring-2 ring-bg">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
