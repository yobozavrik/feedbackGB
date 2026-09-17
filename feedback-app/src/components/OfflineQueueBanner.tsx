"use client";

import { useState } from "react";
import { useOfflineSync } from "./OfflineSyncProvider";
import { deleteOfflineSubmission, updateOfflineSubmissionStatus } from "@/lib/offlineDb";
import { getCategory } from "@/lib/categories";
import {
  ChevronDownIcon,
  CloudOffIcon,
  RefreshIcon,
  TrashIcon,
} from "@/components/icons";

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

// A5: one badge component for the four queue-item states instead of four
// hand-rolled spans (two of them with `dark:` classes that never applied,
// F-5). "Надсилається" is the only one that still needs a pulse dot.
function QueueBadge({ status }: { status: string }) {
  switch (status) {
    case "syncing":
      return (
        <span className="badge inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
          </span>
          Надсилається
        </span>
      );
    case "failed_auth":
      return (
        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
          Потрібен вхід
        </span>
      );
    case "failed_validation":
      return (
        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
          Помилка даних
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-elev2 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
          Очікує мережі
        </span>
      );
  }
}

export function OfflineQueueBanner() {
  const { queue, isOnline, isSyncing, syncNow, refreshQueue } = useOfflineSync();
  const [isOpen, setIsOpen] = useState(false);

  // If there are no items in the queue and we are online, don't show the banner
  if (queue.length === 0 && isOnline) {
    return null;
  }

  const pendingCount = queue.filter((s) => s.status === "pending" || s.status === "syncing").length;
  const errorCount = queue.filter((s) => s.status === "failed_auth" || s.status === "failed_validation").length;

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Видалити заявку? Вона ще не надіслана — її не буде відновлено.")) {
      await deleteOfflineSubmission(id);
      await refreshQueue();
    }
  };

  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await updateOfflineSubmissionStatus(id, { status: "pending", last_error: undefined });
    await refreshQueue();
    syncNow();
  };

  // A5/F-17: category emoji and name now come from the same source of truth
  // as the home screen, instead of a second hand-kept switch that had
  // drifted out of sync with it (📦 here vs 📉 there for "Мало товару", and
  // wording that no longer matched the real category titles).
  const categoryMeta = (id: string) => {
    const c = getCategory(id);
    return { emoji: c?.emoji ?? "📝", title: c?.title ?? id };
  };

  // A5: the header itself carries the state's tone — warning while offline,
  // info while actively syncing, neutral once the queue is just sitting
  // there waiting for a tap.
  const tone = !isOnline ? "callout-warning" : isSyncing ? "callout-info" : "";

  return (
    <div className={`mb-6 overflow-hidden rounded-card shadow-soft transition-all duration-300 ${tone || "border border-ink-300/20 bg-elev"}`}>
      {/* Header Banner */}
      <div
        onClick={() => queue.length > 0 && setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-3 p-4 select-none ${queue.length > 0 ? "cursor-pointer" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <CloudOffIcon size={22} className={`flex-shrink-0 ${tone ? "callout-icon" : "text-ink-500"}`} />
          <div className="min-w-0">
            <h4 className="text-[14px] font-bold leading-none text-ink-900">
              {!isOnline
                ? "Немає інтернету"
                : isSyncing
                  ? "Синхронізація заявок…"
                  : `Не надіслано: ${queue.length}`}
            </h4>
            <p className="mt-0.5 text-meta text-ink-700">
              {queue.length === 0 ? (
                "Якщо зникне інтернет, заявки збережуться на телефоні"
              ) : (
                <>
                  {queue.length} {plural(queue.length, ["заявка", "заявки", "заявок"])}
                  {pendingCount > 0 ? ` · ${pendingCount} чека${pendingCount === 1 ? "є" : "ють"} зв'язку` : ""}
                  {errorCount > 0 ? ` · ${errorCount} з помилкою` : ""}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          {queue.length > 0 && isOnline && !isSyncing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                syncNow();
              }}
              className="btn-primary h-9 px-3 text-[13px]"
            >
              Надіслати
            </button>
          )}
          {queue.length > 0 && (
            <ChevronDownIcon
              size={18}
              className={`text-ink-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            />
          )}
        </div>
      </div>

      {/* Accordion content */}
      {isOpen && queue.length > 0 && (
        <div className="max-h-80 divide-y divide-ink-300/20 overflow-y-auto border-t border-ink-300/20 bg-elev px-4 py-3">
          {queue.map((item) => {
            const canRetry = item.status === "failed_auth";
            const cat = categoryMeta(item.payload.category);
            return (
              <div key={item.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink-900">
                        {cat.emoji} {cat.title}
                      </span>
                      <QueueBadge status={item.status} />
                    </div>

                    <p className="text-meta text-ink-500">
                      Створено: {new Date(item.client_created_at).toLocaleString("uk-UA")}
                    </p>

                    {item.payload.store_label && (
                      <p className="text-[12px] text-ink-700">
                        Магазин: <span className="font-medium">{item.payload.store_label}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 items-center">
                    {canRetry && (
                      <button
                        type="button"
                        onClick={(e) => handleRetry(item.id, e)}
                        aria-label="Повторити спробу"
                        className="btn-icon"
                      >
                        <RefreshIcon size={18} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(item.id, e)}
                      aria-label="Видалити"
                      className="btn-icon text-danger"
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                </div>

                {item.last_error && (
                  <div className="rounded-app bg-danger-soft p-2 text-[12px] font-medium text-danger">
                    Помилка: {item.last_error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
