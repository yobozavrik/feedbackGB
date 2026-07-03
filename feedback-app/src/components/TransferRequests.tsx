"use client";

import { useEffect, useState } from "react";

interface TransferRequestRow {
  id: string;
  created_at: string;
  status: "new" | "in_progress" | "resolved" | "rejected";
  fields: {
    target_store_name?: string | null;
    comment?: string | null;
  };
}

const STATUS_META: Record<
  TransferRequestRow["status"],
  { label: string; className: string }
> = {
  new: { label: "На розгляді", className: "bg-elev2 text-ink-700" },
  in_progress: { label: "В роботі", className: "bg-brand-50 text-brand-600" },
  resolved: { label: "Погоджено", className: "bg-success/15 text-success" },
  rejected: { label: "Не погоджено", className: "bg-danger/15 text-danger" },
};

export function TransferRequests() {
  const [rows, setRows] = useState<TransferRequestRow[] | null>(null);

  useEffect(() => {
    fetch("/api/hr/transfer-requests")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j: { rows?: TransferRequestRow[] }) => setRows(j.rows ?? []))
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
        Мої заявки на переведення
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
                {r.fields.target_store_name ?? "магазин не вказано"}
              </p>
              {r.fields.comment ? (
                <p className="mt-0.5 truncate text-[12px] text-ink-500">{r.fields.comment}</p>
              ) : null}
            </div>
            <span className={`pill flex-shrink-0 ${meta.className}`}>{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}
