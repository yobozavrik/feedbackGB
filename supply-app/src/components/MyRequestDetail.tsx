"use client";

import { useEffect, useState } from "react";
import {
  CONSUMABLES_STATUS_META,
  CONSUMABLES_TIMELINE,
  type ConsumablesStatus,
} from "@/lib/consumablesStatusMeta";

interface Comment {
  id: string;
  body: string;
  created_at: string;
  author_full_name: string;
}
interface ConsumablesItem {
  product_id: number;
  name: string;
  unit: string | null;
  category_name: string | null;
  quantity: number;
  photo_url: string | null;
}
interface ConsumablesDetail {
  status: ConsumablesStatus;
  order_number: string | null;
  items: ConsumablesItem[];
  timeline: {
    submitted_at: string | null;
    picking_at: string | null;
    shipped_at: string | null;
  };
}
interface DetailPayload {
  feedback: {
    id: string;
    category: string;
    category_emoji: string | null;
    category_title: string | null;
    summary: string | null;
    status: "new" | "in_progress" | "resolved" | "rejected";
    created_at: string;
    store_name: string | null;
    facility_name: string | null;
    fields: Record<string, unknown>;
  };
  comments: Comment[];
  consumables: ConsumablesDetail | null;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function MyRequestDetail({ id }: { id: string }) {
  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/my-feedback/${id}`)
      .then(async (r) => {
        if (r.status === 404) throw new Error("Заявку не знайдено");
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: DetailPayload) => setPayload(j))
      .catch((e: Error) => setError(e.message === "Заявку не знайдено" ? e.message : "Не вдалося завантажити"));
  }, [id]);

  if (error) return <p className="mt-6 px-1 text-[13px] text-brand-600">{error}</p>;
  if (!payload) return <p className="mt-6 px-1 text-[13px] text-ink-500">Завантаження…</p>;

  const { feedback, comments, consumables } = payload;
  const location = feedback.facility_name ?? feedback.store_name;

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <p className="text-[13px] font-semibold text-ink-900">
          <span aria-hidden className="mr-1">{feedback.category_emoji ?? "🗂️"}</span>
          {feedback.category_title ?? feedback.category}
        </p>
        <p className="mt-1 text-[12px] text-ink-500">
          {fmtDateTime(feedback.created_at)}
          {location ? ` · ${location}` : ""}
        </p>
        {feedback.summary ? (
          <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-ink-900">{feedback.summary}</p>
        ) : null}
      </section>

      {consumables ? (
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold text-ink-900">Стан на складі</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONSUMABLES_STATUS_META[consumables.status].chipClass}`}>
              {CONSUMABLES_STATUS_META[consumables.status].label}
            </span>
          </div>
          <ol className="mb-4 space-y-2">
            {CONSUMABLES_TIMELINE.map((step, idx) => {
              const currentStep = CONSUMABLES_STATUS_META[consumables.status].step;
              const done = idx <= currentStep;
              return (
                <li key={step.label} className="flex items-start gap-3">
                  <span className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${done ? "border-brand-500 bg-brand-500" : "border-ink-300/50 bg-elev"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium ${done ? "text-ink-900" : "text-ink-500"}`}>{step.label}</p>
                    <p className="text-[11px] text-ink-500">{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {consumables.items.length > 0 ? (
            <ul className="space-y-2">
              {consumables.items.map((it) => (
                <li key={it.product_id} className="flex items-center gap-3 rounded-lg border border-ink-300/20 p-2">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-elev2 text-ink-500" aria-hidden>📦</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-ink-900">{it.name}</p>
                    <p className="text-[11px] text-ink-500">
                      {it.quantity}{it.unit ? ` ${it.unit}` : ""}
                      {it.category_name ? ` · ${it.category_name}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 px-1 font-display text-[13px] font-semibold text-ink-900">Коментарі</h3>
        {comments.length === 0 ? (
          <p className="px-1 text-[12px] text-ink-500">Ще немає відповіді від менеджера.</p>
        ) : (
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="card p-3">
                <p className="text-[11px] font-semibold text-brand-600">{c.author_full_name}</p>
                <p className="mt-1 whitespace-pre-line text-[13px] text-ink-900">{c.body}</p>
                <p className="mt-1 text-[11px] text-ink-500">{fmtDateTime(c.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
