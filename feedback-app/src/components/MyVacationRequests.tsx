"use client";

import { useEffect, useState } from "react";

interface VacationRequestRow {
  id: string;
  created_at: string;
  status: "new" | "in_progress" | "resolved" | "rejected";
  fields: {
    date_from?: string;
    date_to?: string;
    comment?: string | null;
  };
}

const STATUS_META: Record<
  VacationRequestRow["status"],
  { label: string; className: string }
> = {
  new: { label: "На розгляді", className: "bg-elev2 text-ink-700" },
  in_progress: { label: "В роботі", className: "bg-brand-50 text-brand-600" },
  resolved: { label: "Погоджено", className: "bg-success/15 text-success" },
  rejected: { label: "Не погоджено", className: "bg-danger/15 text-danger" },
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function MyVacationRequests() {
  const [rows, setRows] = useState<VacationRequestRow[] | null>(null);

  useEffect(() => {
    fetch("/api/hr/vacation-requests")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j: { rows?: VacationRequestRow[] }) => setRows(j.rows ?? []))
      .catch(() => setRows([]));
  }, []);

  if (rows === null) {
    return (
      <div className="mt-4 space-y-2">
        <div className="skeleton h-14 w-full rounded-xl" />
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-6 space-y-2">
      <h3 className="px-1 font-display text-[14px] font-semibold text-ink-900">
        Мої заявки на відпустку
      </h3>
      {rows.map((r) => {
        const meta = STATUS_META[r.status] ?? STATUS_META.new;
        return (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-xl border border-ink-300/20 bg-elev p-3 shadow-soft"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink-900">
                {r.fields.date_from ? formatDate(r.fields.date_from) : "?"}
                {" – "}
                {r.fields.date_to ? formatDate(r.fields.date_to) : "?"}
              </p>
              {r.fields.comment ? (
                <p className="mt-0.5 truncate text-[12px] text-ink-500">
                  {r.fields.comment}
                </p>
              ) : null}
            </div>
            <span className={`pill flex-shrink-0 ${meta.className}`}>{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}
