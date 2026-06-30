"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  lines: Array<{ label: string; value: string }>;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Mini confirm bottom sheet shown right before final submit.
 * Per Галя's choice: short confirmation step, two big buttons.
 */
export function ConfirmSheet({
  open,
  title,
  lines,
  submitting,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Скасувати"
        onClick={onCancel}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-bg p-5 pb-7 shadow-2xl animate-slide-up sm:left-1/2 sm:max-w-md sm:-translate-x-1/2"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink-300/40" />
        <h2 className="font-display text-[18px] font-semibold text-ink-900">
          {title}
        </h2>
        <ul className="mt-4 space-y-2 rounded-lg border border-ink-300/20 bg-elev2 p-4">
          {lines.map((l) => (
            <li key={l.label} className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] uppercase tracking-wide text-ink-500">
                {l.label}
              </span>
              <span className="text-right text-[14px] font-medium text-ink-900">
                {l.value}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="btn-ghost flex-1"
          >
            Ні, поправлю
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="btn-primary flex-1"
          >
            {submitting ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <>Так, надіслати ✓</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
