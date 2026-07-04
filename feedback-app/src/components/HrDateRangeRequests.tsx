"use client";

import { useEffect, useState } from "react";
import { STATUS_META, type FeedbackStatus } from "@/lib/feedbackStatusMeta";

interface HrDateRangeRow {
  id: string;
  created_at: string;
  status: FeedbackStatus;
  fields: {
    date_from?: string;
    date_to?: string;
    comment?: string | null;
  };
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface Props {
  /** Path segment identifying the topic-scoped list endpoint, e.g. "vacation-requests". */
  endpoint: string;
  title: string;
}

export function HrDateRangeRequests({ endpoint, title }: Props) {
  const [rows, setRows] = useState<HrDateRangeRow[] | null>(null);

  useEffect(() => {
    fetch(`/api/hr/${endpoint}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j: { rows?: HrDateRangeRow[] }) => setRows(j.rows ?? []))
      .catch(() => setRows([]));
  }, [endpoint]);

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
      <h3 className="px-1 font-display text-[14px] font-semibold text-ink-900">{title}</h3>
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
