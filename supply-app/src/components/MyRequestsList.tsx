"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONSUMABLES_STATUS_META, type ConsumablesStatus } from "@/lib/consumablesStatusMeta";

type Status = "new" | "in_progress" | "resolved" | "rejected";
interface Row {
  id: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  summary: string | null;
  status: Status;
  assigned_full_name: string | null;
  created_at: string;
  resolved_at: string | null;
  item_count?: number;
  consumables_status?: ConsumablesStatus | null;
}

const STATUS_LABEL: Record<Status, string> = {
  new: "Нова",
  in_progress: "В роботі",
  resolved: "Опрацьовано",
  rejected: "Відхилено",
};
const STATUS_TONE: Record<Status, string> = {
  new: "bg-brand-50 text-brand-600",
  in_progress: "bg-amber-100 text-amber-700",
  resolved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isArchived(r: Row): boolean {
  return r.status === "resolved" || r.status === "rejected";
}

export function MyRequestsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive">("active");

  useEffect(() => {
    fetch("/api/my-feedback?limit=100")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { rows?: Row[] }) => setRows(j.rows ?? []))
      .catch(() => setError("Не вдалося завантажити"));
  }, []);

  if (error) return <p className="mt-6 px-1 text-[13px] text-ink-500">{error}</p>;
  if (rows === null) return <p className="mt-6 px-1 text-[13px] text-ink-500">Завантаження…</p>;

  const active = rows.filter((r) => !isArchived(r));
  const archive = rows.filter(isArchived);
  const list = tab === "active" ? active : archive;

  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-2 border-b border-ink-300/20">
        <button
          role="tab"
          aria-selected={tab === "active"}
          onClick={() => setTab("active")}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${
            tab === "active" ? "border-brand-500 text-brand-600" : "border-transparent text-ink-500"
          }`}
        >
          Активні · {active.length}
        </button>
        <button
          role="tab"
          aria-selected={tab === "archive"}
          onClick={() => setTab("archive")}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${
            tab === "archive" ? "border-brand-500 text-brand-600" : "border-transparent text-ink-500"
          }`}
        >
          Архів · {archive.length}
        </button>
      </div>

      {list.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-ink-500">
          {tab === "active" ? "Активних заявок немає." : "Архів порожній."}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => {
            const consumablesMeta = r.consumables_status ? CONSUMABLES_STATUS_META[r.consumables_status] : null;
            return (
              <li key={r.id}>
                <Link
                  href={`/home/my-requests/${r.id}`}
                  className="card block p-3 transition-all hover:-translate-y-0.5 active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-ink-900">
                        <span aria-hidden className="mr-1">{r.category_emoji ?? "🗂️"}</span>
                        {r.category_title ?? r.category}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-500">
                        {r.summary ?? ""}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-500">
                        {fmtDate(r.created_at)}
                        {r.category === "consumables_request" && r.item_count != null ? ` · ${r.item_count} позиц.` : ""}
                        {r.assigned_full_name ? ` · ${r.assigned_full_name}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${consumablesMeta?.chipClass ?? STATUS_TONE[r.status]}`}>
                      {consumablesMeta?.label ?? STATUS_LABEL[r.status]}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
