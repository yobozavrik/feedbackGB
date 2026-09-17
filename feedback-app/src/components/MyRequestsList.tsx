"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { AlertTriangleIcon, InboxIcon } from "@/components/icons";
import { getCategory } from "@/lib/categories";
import { CATEGORY_TINT_BG } from "@/lib/categoryTint";
import type { FeedbackStatus } from "@/lib/feedbackStatusMeta";

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
  return `${Math.floor(hr / 24)} дн. тому`;
}

const ARCHIVE_STATUSES = new Set<FeedbackStatus>(["resolved", "rejected"]);

type Tab = "active" | "archive";

export function MyRequestsList() {
  const [rows, setRows] = useState<MyFeedbackRow[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("active");

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
        <div className="skeleton h-16 w-full rounded-card" />
        <div className="skeleton h-16 w-full rounded-card" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="callout callout-danger mt-4">
        <AlertTriangleIcon size={18} className="callout-icon" />
        Не вдалося завантажити заявки. Онови сторінку.
      </div>
    );
  }

  const visibleRows = rows.filter((r) =>
    tab === "archive" ? ARCHIVE_STATUSES.has(r.status) : !ARCHIVE_STATUSES.has(r.status),
  );

  return (
    <div className="mt-4">
      {/* C6: taller, more legible tab switch. */}
      <div className="mb-3 flex gap-1 rounded-full bg-elev2 p-1">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`flex-1 rounded-full py-2 text-[14px] font-semibold transition ${
            tab === "active" ? "bg-elev text-ink-900 shadow-soft" : "text-ink-500"
          }`}
        >
          Активні
        </button>
        <button
          type="button"
          onClick={() => setTab("archive")}
          className={`flex-1 rounded-full py-2 text-[14px] font-semibold transition ${
            tab === "archive" ? "bg-elev text-ink-900 shadow-soft" : "text-ink-500"
          }`}
        >
          Архів
        </button>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={26} />}
          title={tab === "archive" ? "Архів порожній" : "Активних заявок немає"}
          subtitle={
            tab === "archive"
              ? "Сюди потраплять погоджені та відхилені заявки."
              : "Тут з'являться заявки, які ще розглядають."
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleRows.map((r) => {
            // C5: category icon on its own tint, like the home-screen cards.
            const tint = getCategory(r.category)?.tint;
            return (
              <Link
                key={r.id}
                href={`/my-requests/${r.id}`}
                className="block rounded-card border border-ink-300/20 bg-elev p-3 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 gap-2.5">
                    <span
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base ${tint ? CATEGORY_TINT_BG[tint] : "bg-elev2"}`}
                      aria-hidden
                    >
                      {r.category_emoji ?? "📝"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-ink-900">
                        {r.category_title ?? r.category}
                      </p>
                      {r.summary ? (
                        <p className="mt-0.5 truncate text-[13px] text-ink-700">{r.summary}</p>
                      ) : null}
                    </div>
                  </div>
                  <StatusPill status={r.status} className="flex-shrink-0" />
                </div>
                <div className="mt-2 flex items-center justify-between pl-[46px] text-meta text-ink-500">
                  <span>
                    {r.assigned_full_name
                      ? `Відповідальний: ${r.assigned_full_name}`
                      : "Відповідального ще не призначено"}
                  </span>
                  <span>{formatRelative(r.created_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
