"use client";
import { useEffect } from "react";
import { App, Button, Space } from "antd";
import Link from "next/link";
import type { CalendarTask } from "@/lib/admin/calendar";

/** In-app only: persisted acknowledgements, no browser/push/email delivery. */
export function CalendarReminders() {
  const { notification, message } = App.useApp();
  useEffect(() => {
    let alive = true; let busy = false;
    const shown = new Set<string>();
    async function check() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const response = await fetch("/api/admin/calendar?mode=reminders", { cache: "no-store" });
        if (!response.ok) return;
        const { tasks } = await response.json() as { tasks: CalendarTask[] };
        if (!alive) return;
        for (const task of tasks.slice(0, 5)) {
          const key = `calendar:${task.id}:${task.row_version}`;
          if (shown.has(key)) continue;
          shown.add(key);
          notification.info({ key, message: task.title, description: `Задача на ${new Date(task.due_at).toLocaleString("uk-UA")}`, duration: 0,
            btn: <Space><Link href="/admin/calendar">Календар</Link><Button size="small" onClick={async () => {
              try {
                const result = await fetch("/api/admin/calendar", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, row_version: task.row_version, acknowledge: true }) });
                if (!result.ok) { message.error("Задача змінилася. Оновіть календар"); return; }
                notification.destroy(key);
              } catch { message.error("Не вдалося підтвердити нагадування"); }
            }}>Зрозуміло</Button></Space>,
          });
        }
      } catch { /* Retry next minute; don't flood UI during network outage. */ }
      finally { busy = false; }
    }
    void check();
    const interval = window.setInterval(() => void check(), 60000);
    document.addEventListener("visibilitychange", check);
    return () => { alive = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", check); for (const key of shown) notification.destroy(key); };
  }, [notification, message]);
  return null;
}
