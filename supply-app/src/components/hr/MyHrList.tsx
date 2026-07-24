"use client";

import { useEffect, useState } from "react";

type Status = "new" | "in_progress" | "resolved" | "rejected";
interface Row {
  id: string;
  created_at: string;
  status: Status;
  fields: Record<string, unknown>;
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
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function fmtRange(f: Record<string, unknown>): string {
  const from = typeof f.date_from === "string" ? fmtDate(f.date_from) : null;
  const to = typeof f.date_to === "string" ? fmtDate(f.date_to) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return from;
  return "";
}

function summary(f: Record<string, unknown>): string {
  const range = fmtRange(f);
  const target =
    typeof f.target_facility_name === "string"
      ? String(f.target_facility_name)
      : typeof f.target_store_name === "string"
        ? String(f.target_store_name)
        : "";
  const comment = typeof f.comment === "string" ? f.comment : "";
  return [range, target, comment].filter(Boolean).join(" · ");
}

export function MyHrList({ endpoint, title }: { endpoint: string; title: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/hr/${endpoint}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { rows?: Row[] }) => setRows(j.rows ?? []))
      .catch(() => setError("Не вдалося завантажити"));
  }, [endpoint]);

  if (error) {
    return <p className="mt-8 px-1 text-[13px] text-ink-500">{error}</p>;
  }
  if (rows === null) {
    return <p className="mt-8 px-1 text-[13px] text-ink-500">Завантаження…</p>;
  }
  if (rows.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 px-1 font-display text-[15px] font-semibold text-ink-900">{title}</h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="card flex items-start justify-between gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-900">{summary(r.fields) || "Заявка"}</p>
              <p className="mt-0.5 text-[11px] text-ink-500">{fmtDate(r.created_at)}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status]}`}>
              {STATUS_LABEL[r.status]}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
