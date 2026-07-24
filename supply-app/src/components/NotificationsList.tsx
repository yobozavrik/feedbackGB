"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NotificationRow } from "@/lib/notifications";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function NotificationsList() {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  async function reload() {
    try {
      const r = await fetch("/api/notifications?limit=50");
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { notifications: NotificationRow[] };
      setRows(j.notifications);
    } catch {
      setError("Не вдалося завантажити");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function markAllRead() {
    setMarkingAll(true);
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    await reload();
    setMarkingAll(false);
  }

  async function markOne(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setRows((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)) : prev));
  }

  if (error) return <p className="mt-6 px-1 text-[13px] text-brand-600">{error}</p>;
  if (rows === null) return <p className="mt-6 px-1 text-[13px] text-ink-500">Завантаження…</p>;

  const unread = rows.filter((n) => !n.is_read).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-ink-500">
          {unread > 0 ? `Непрочитаних: ${unread}` : "Усе прочитано"}
        </p>
        {unread > 0 ? (
          <button type="button" onClick={markAllRead} disabled={markingAll}
            className="rounded-full bg-elev2 px-3 py-1 text-[12px] font-semibold text-ink-700 disabled:opacity-50">
            Прочитати все
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-ink-500">Сповіщень немає.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => {
            const body = (
              <div className={`card block p-3 ${n.is_read ? "" : "border-brand-500/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-[13px] font-semibold ${n.is_read ? "text-ink-900" : "text-brand-600"}`}>{n.title}</p>
                  {!n.is_read ? <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" aria-hidden /> : null}
                </div>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{n.body}</p>
                <p className="mt-1 text-[11px] text-ink-500">{fmtDateTime(n.created_at)}</p>
              </div>
            );
            return (
              <li key={n.id}>
                {n.feedback_id ? (
                  <Link href={`/home/my-requests/${n.feedback_id}`} onClick={() => void markOne(n.id)}>
                    {body}
                  </Link>
                ) : (
                  <button type="button" onClick={() => void markOne(n.id)} className="block w-full text-left">
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
