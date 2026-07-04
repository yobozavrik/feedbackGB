"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STATUS_META, type FeedbackStatus } from "@/lib/feedbackStatusMeta";

interface MyFeedbackRow {
  id: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  summary: string | null;
  status: FeedbackStatus;
  assigned_full_name: string | null;
  created_at: string;
  resolved_at: string | null;
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

export function MyRequestsList() {
  const [rows, setRows] = useState<MyFeedbackRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/my-feedback?limit=50")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { rows?: MyFeedbackRow[] }) => {
        setRows(j.rows ?? []);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  if (rows === null) {
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
        Не вдалося завантажити заявки.
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="mt-8 text-center text-[13px] text-ink-500">Немає заявок</p>;
  }

  return (
    <div className="mt-4 space-y-2">
      {rows.map((r) => {
        const meta = STATUS_META[r.status] ?? STATUS_META.new;
        return (
          <Link
            key={r.id}
            href={`/my-requests/${r.id}`}
            className="block rounded-xl border border-ink-300/20 bg-elev p-3 shadow-soft"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 gap-2">
                <span className="flex-shrink-0 text-base" aria-hidden>
                  {r.category_emoji ?? "📝"}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink-900">
                    {r.category_title ?? r.category}
                  </p>
                  {r.summary ? (
                    <p className="mt-0.5 truncate text-[12px] text-ink-500">{r.summary}</p>
                  ) : null}
                </div>
              </div>
              <span className={`pill flex-shrink-0 ${meta.className}`}>{meta.label}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-ink-500">
                {r.assigned_full_name
                  ? `Відповідальний: ${r.assigned_full_name}`
                  : "Ще не призначено"}
              </span>
              <span className="text-[11px] text-ink-500">{formatRelative(r.created_at)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
