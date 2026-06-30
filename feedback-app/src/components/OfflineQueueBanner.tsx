"use client";

import { useState } from "react";
import { useOfflineSync } from "./OfflineSyncProvider";
import { deleteOfflineSubmission, updateOfflineSubmissionStatus } from "@/lib/offlineDb";

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
    if (confirm("Ви дійсно хочете видалити цей невідправлений відгук?")) {
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "syncing":
        return (
          <span className="flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            Надсилається
          </span>
        );
      case "failed_auth":
        return (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            🔐 Зміна продавця
          </span>
        );
      case "failed_validation":
        return (
          <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
            ⚠️ Помилка даних
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-800 dark:bg-gray-800 dark:text-gray-300">
            ⏳ Очікує мережі
          </span>
        );
    }
  };

  const getCategoryEmoji = (cat: string) => {
    switch (cat) {
      case "missing_item": return "📦";
      case "overstock": return "📈";
      case "defect": return "💔";
      case "tech_issue": return "🔧";
      case "consumables_request": return "📋";
      default: return "📝";
    }
  };

  const getCategoryName = (cat: string) => {
    switch (cat) {
      case "missing_item": return "Мало товару";
      case "overstock": return "Багато товару";
      case "defect": return "Брак / Списання";
      case "tech_issue": return "Тех. проблема";
      case "consumables_request": return "Замовлення розхідників";
      default: return cat;
    }
  };

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-amber-500/20 bg-amber-50/40 shadow-soft backdrop-blur-sm transition-all duration-300">
      {/* Header Banner */}
      <div 
        onClick={() => queue.length > 0 && setIsOpen(!isOpen)}
        className={`flex items-center justify-between p-4 ${queue.length > 0 ? "cursor-pointer hover:bg-amber-100/20" : ""} select-none`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">
            {!isOnline ? "🔌" : isSyncing ? "⚡" : "📂"}
          </span>
          <div className="space-y-0.5">
            <h4 className="text-[14px] font-bold text-ink-900 leading-none">
              {!isOnline 
                ? "Офлайн-режим" 
                : isSyncing 
                  ? "Синхронізація відгуків..." 
                  : "Черга невідправлених відгуків"}
            </h4>
            <p className="text-[12px] text-ink-600">
              {queue.length === 0 ? (
                "Відгуки будуть збережені локально при втраті зв'язку"
              ) : (
                <>
                  В черзі: {queue.length} відгук(ів)
                  {pendingCount > 0 && ` • Очікує: ${pendingCount}`}
                  {errorCount > 0 && ` • З помилками: ${errorCount}`}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {queue.length > 0 && isOnline && !isSyncing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                syncNow();
              }}
              className="rounded-lg bg-amber-500 hover:bg-amber-600 px-3 py-1 text-[12px] font-bold text-white shadow-sm transition-colors"
            >
              Синхронізувати
            </button>
          )}
          {queue.length > 0 && (
            <span className={`text-[12px] text-amber-600 font-bold transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
              ▼
            </span>
          )}
        </div>
      </div>

      {/* Accordion content */}
      {isOpen && queue.length > 0 && (
        <div className="border-t border-amber-500/10 bg-amber-50/20 px-4 py-3 divide-y divide-amber-500/10 max-h-80 overflow-y-auto">
          {queue.map((item) => {
            const canRetry = item.status === "failed_auth";
            return (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink-900">
                        {getCategoryEmoji(item.payload.category)} {getCategoryName(item.payload.category)}
                      </span>
                      {getStatusBadge(item.status)}
                    </div>
                    
                    <p className="text-[11px] text-ink-500">
                      Створено: {new Date(item.client_created_at).toLocaleString("uk-UA")}
                    </p>
                    
                    {item.payload.store_label && (
                      <p className="text-[12px] text-ink-700">
                        Магазин: <span className="font-medium">{item.payload.store_label}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {canRetry && (
                      <button
                        type="button"
                        onClick={(e) => handleRetry(item.id, e)}
                        title="Повторити спробу"
                        className="p-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-700 text-[12px] transition-colors"
                      >
                        🔄
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(item.id, e)}
                      title="Видалити"
                      className="p-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 text-[12px] transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {item.last_error && (
                  <div className="rounded bg-rose-50/60 p-2 text-[11px] font-medium text-rose-700 border border-rose-500/10">
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
