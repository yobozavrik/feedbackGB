"use client";

import { useEffect, useState } from "react";
import { STATUS_META, type FeedbackStatus } from "@/lib/feedbackStatusMeta";
import {
  CONSUMABLES_STATUS_META,
  CONSUMABLES_TIMELINE,
  type ConsumablesStatus,
} from "@/lib/consumablesStatusMeta";
import { CheckCircleIcon, ClipboardCheckIcon, EditIcon, MessageIcon, PackageIcon } from "@/components/icons";

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

interface OrderItem {
  product_id: number;
  name: string;
  unit: string | null;
  category_name: string | null;
  quantity: number;
  photo_url: string | null;
}

interface ConsumablesOrder {
  status: ConsumablesStatus;
  order_number: string | null;
  items: OrderItem[];
  timeline: {
    submitted_at: string | null;
    picking_at: string | null;
    shipped_at: string | null;
  };
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
  const [data, setData] = useState<{ feedback: FeedbackDetail; comments: CommentItem[]; consumables?: ConsumablesOrder | null } | null>(
    null,
  );
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [editNote, setEditNote] = useState(false);

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

  const { feedback, comments, consumables } = data;
  const meta = STATUS_META[feedback.status] ?? STATUS_META.new;
  const isConsumables = feedback.category === "consumables_request";
  const orderComment = typeof feedback.fields?.comment === "string" ? feedback.fields.comment : null;
  const cMeta = consumables ? CONSUMABLES_STATUS_META[consumables.status] : null;
  const timelineTimes = consumables
    ? [consumables.timeline.submitted_at, consumables.timeline.picking_at, consumables.timeline.shipped_at]
    : [];
  // For consumables the order line-items + comment are rendered as dedicated
  // blocks below, so drop them from the generic per-field dump.
  const fieldEntries = Object.entries(feedback.fields ?? {}).filter(
    ([key, value]) =>
      !HIDDEN_FIELD_KEYS.has(key) &&
      !(isConsumables && key === "comment") &&
      value !== null && value !== undefined && value !== "",
  );

  return (
    <>
    <div className={`mt-4 space-y-4 ${isConsumables ? "pb-24" : ""}`}>
      {isConsumables && cMeta ? (
        <div className="rounded-xl border border-ink-300/20 bg-elev p-3.5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <ClipboardCheckIcon size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">Поточний статус</p>
                <p className="text-[15px] font-semibold text-ink-900">{cMeta.label}</p>
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${cMeta.chipClass}`}>{cMeta.label}</span>
          </div>
          {consumables?.order_number ? (
            <p className="mt-2 border-t border-ink-300/15 pt-2 text-[11px] text-ink-500">Замовлення {consumables.order_number}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className={`pill ${meta.className}`}>{meta.label}</span>
          <span className="text-[11px] text-ink-500">
            подано {formatDateTime(feedback.created_at)}
          </span>
        </div>
      )}

      {isConsumables && consumables && consumables.items.length > 0 ? (
        <div>
          <p className="mb-2 ml-1 text-[12px] font-semibold uppercase tracking-[0.03em] text-ink-500">
            Товари у замовленні
          </p>
          <div className="space-y-2">
            {consumables.items.map((item) => (
              <div key={item.product_id} className="flex items-center gap-4 rounded-xl border border-ink-300/20 bg-elev p-3 shadow-soft">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt="" loading="lazy" className="h-16 w-16 flex-shrink-0 rounded-lg border border-ink-300/20 object-cover" />
                ) : (
                  <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <PackageIcon size={24} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[15px] font-semibold text-ink-900">{item.name}</h4>
                  {item.category_name ? <p className="mt-0.5 truncate text-[13px] text-ink-500">{item.category_name}</p> : null}
                </div>
                <p className="flex-shrink-0 text-[15px] font-semibold text-brand-600">
                  {item.quantity} {item.unit ?? "шт"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isConsumables && orderComment ? (
        <div className="flex gap-3 rounded-xl border border-brand-500/20 bg-brand-50/40 p-3.5">
          <span className="mt-0.5 flex-shrink-0 text-brand-600"><MessageIcon size={18} /></span>
          <div>
            <p className="text-[12px] font-semibold text-brand-600">Коментар для комірника</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-900">{orderComment}</p>
          </div>
        </div>
      ) : null}

      {isConsumables && consumables ? (
        <div>
          <p className="mb-2 ml-1 text-[12px] font-semibold uppercase tracking-[0.03em] text-ink-500">
            Історія обробки
          </p>
          <div className="rounded-xl border border-ink-300/20 bg-elev p-4 shadow-soft">
            {CONSUMABLES_TIMELINE.map((step, i) => {
              const done = i <= cMeta!.step;
              const isLast = i === CONSUMABLES_TIMELINE.length - 1;
              const at = timelineTimes[i];
              return (
                <div key={step.label} className={`relative ml-2 pl-8 ${isLast ? "" : "border-l-2 pb-5"} ${i < cMeta!.step ? "border-brand-500" : "border-ink-300/40"}`}>
                  <span className={`absolute -left-[11px] top-0 flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-brand-500 text-white" : "border-2 border-ink-300 bg-elev"}`}>
                    {done ? <CheckCircleIcon size={13} /> : <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />}
                  </span>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className={`text-[14px] font-semibold ${done ? "text-ink-900" : "text-ink-500"}`}>{step.label}</p>
                      <p className="text-[12px] text-ink-500">{step.description}</p>
                    </div>
                    {at ? <span className="shrink-0 text-[11px] text-ink-500">{formatDateTime(at)}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {isConsumables && editNote ? (
        <p className="text-center text-[12px] text-ink-500">
          Редагування поданої заявки буде доступне згодом. Щоб змінити — створіть нову заявку.
        </p>
      ) : null}

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

      {!isConsumables ? (
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
      ) : null}

      {!isConsumables || comments.length > 0 ? (
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
      ) : null}
    </div>

    {isConsumables ? (
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setEditNote((v) => !v)} className="btn-ghost h-12 w-full gap-2">
            <EditIcon size={18} /> Змінити
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}
