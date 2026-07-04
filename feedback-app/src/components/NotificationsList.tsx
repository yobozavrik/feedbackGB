"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  feedback_id: string | null;
  is_read: boolean;
  created_at: string;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год тому`;
  return `${Math.floor(hr / 24)} дн тому`;
}

export function NotificationsList() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetch("/api/notifications?limit=50")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { notifications?: NotificationItem[] }) => {
        setItems(j.notifications ?? []);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = useCallback((id: string) => {
    setItems((prev) =>
      prev ? prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)) : prev,
    );
    fetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {
      /* optimistic; next load reconciles */
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => (prev ? prev.map((n) => ({ ...n, is_read: true })) : prev));
    fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {
      /* optimistic; next load reconciles */
    });
  }, []);

  const onItemClick = useCallback(
    (n: NotificationItem) => {
      if (!n.is_read) markRead(n.id);
      if (n.feedback_id) router.push(`/my-requests/${n.feedback_id}`);
    },
    [markRead, router],
  );

  if (items === null) {
    return (
      <div className="mt-4 space-y-2">
        <div className="skeleton h-16 w-full rounded-xl" />
        <div className="skeleton h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="mt-4 text-[13px] text-ink-500">
        Не вдалося завантажити сповіщення.
      </p>
    );
  }

  const hasUnread = items.some((n) => !n.is_read);

  return (
    <div className="mt-4">
      {hasUnread ? (
        <button
          type="button"
          onClick={markAllRead}
          className="mb-3 text-[12px] font-semibold text-brand-500"
        >
          Прочитати всі
        </button>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-ink-500">Немає сповіщень</p>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onItemClick(n)}
              className={`w-full rounded-xl border border-ink-300/20 p-3 text-left shadow-soft ${
                n.is_read ? "bg-elev" : "bg-brand-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink-900">{n.title}</p>
                {!n.is_read ? (
                  <span
                    aria-hidden
                    className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500"
                  />
                ) : null}
              </div>
              <p className="mt-0.5 text-[12px] text-ink-500">{n.body}</p>
              <p className="mt-1 text-[11px] text-ink-500">{formatRelative(n.created_at)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
