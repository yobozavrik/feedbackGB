"use client";

import { useEffect, useState } from "react";
import { STATUS_META, type FeedbackStatus } from "@/lib/feedbackStatusMeta";

interface FeedbackDetail {
  id: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  status: FeedbackStatus;
  assigned_full_name: string | null;
  created_at: string;
  fields: Record<string, unknown>;
}

interface CommentItem {
  id: string;
  body: string;
  author_full_name: string;
  created_at: string;
}

const HIDDEN_FIELD_KEYS = new Set(["photo_urls", "hr_topic"]);

function fieldLabel(key: string): string {
  const OVERRIDES: Record<string, string> = {
    comment: "Коментар",
    target_store_name: "Бажаний магазин",
    target_store_id: "Бажаний магазин (ID)",
    date_from: "Дата початку",
    date_to: "Дата закінчення",
    product_name: "Товар",
    quantity: "Кількість",
    product_unit: "Одиниця",
    item_name: "Назва товару",
  };
  return OVERRIDES[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  id: string;
}

export function RequestDetail({ id }: Props) {
  const [data, setData] = useState<{ feedback: FeedbackDetail; comments: CommentItem[] } | null>(
    null,
  );
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/my-feedback/${id}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error("bad_status");
        return r.json();
      })
      .then((j) => {
        if (j) setData(j);
        setError(false);
      })
      .catch(() => setError(true));
  }, [id]);

  if (notFound) {
    return <p className="mt-8 text-center text-[13px] text-ink-500">Заявку не знайдено</p>;
  }

  if (error) {
    return (
      <p className="mt-4 text-[13px] text-ink-500">Не вдалося завантажити заявку.</p>
    );
  }

  if (data === null) {
    return (
      <div className="mt-4 space-y-2">
        <div className="skeleton h-24 w-full rounded-xl" />
        <div className="skeleton h-16 w-full rounded-xl" />
      </div>
    );
  }

  const { feedback, comments } = data;
  const meta = STATUS_META[feedback.status] ?? STATUS_META.new;
  const fieldEntries = Object.entries(feedback.fields ?? {}).filter(
    ([key, value]) => !HIDDEN_FIELD_KEYS.has(key) && value !== null && value !== undefined && value !== "",
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className={`pill ${meta.className}`}>{meta.label}</span>
        <span className="text-[11px] text-ink-500">
          подано {formatDateTime(feedback.created_at)}
        </span>
      </div>

      {fieldEntries.length > 0 ? (
        <div className="rounded-xl border border-ink-300/20 bg-elev p-3 shadow-soft">
          <table className="w-full text-[13px]">
            <tbody>
              {fieldEntries.map(([key, value]) => (
                <tr key={key}>
                  <td className="py-1 pr-2 text-ink-500">{fieldLabel(key)}</td>
                  <td className="py-1 text-right font-medium text-ink-900">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-xl px-1 py-1">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-600">
          {feedback.assigned_full_name
            ? feedback.assigned_full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()
            : "?"}
        </div>
        <div>
          <p className="text-[12px] text-ink-500">Відповідальний</p>
          <p className="text-[13px] font-medium text-ink-900">
            {feedback.assigned_full_name ?? "Ще не призначено"}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.03em] text-ink-500">
          Коментарі
        </p>
        {comments.length === 0 ? (
          <p className="text-[13px] text-ink-500">Ще немає коментарів</p>
        ) : (
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-xl bg-elev2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-brand-600">
                    {c.author_full_name}
                  </span>
                  <span className="text-[11px] text-ink-500">{formatDateTime(c.created_at)}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-900">{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
