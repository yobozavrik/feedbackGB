"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { submitHrRequest } from "@/lib/hrClient";

interface Target {
  kind: "store" | "facility";
  id: string;
  name: string;
}

export function TransferForm() {
  const router = useRouter();
  const [targets, setTargets] = useState<Target[]>([]);
  const [selected, setSelected] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/transfer-targets")
      .then((r) => r.json())
      .then((j: { rows?: Target[] }) => setTargets(j.rows ?? []))
      .catch(() => setError("Не вдалося завантажити список"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const target = targets.find((t) => `${t.kind}:${t.id}` === selected);
    if (!target) return setError("Обери місце для переведення");
    setBusy(true);
    const fields: Record<string, string | number | null> = {
      hr_topic: "transfer",
      comment: comment.trim() || null,
    };
    if (target.kind === "store") fields.target_store_id = Number(target.id);
    else fields.target_facility_id = target.id;
    try {
      await submitHrRequest(fields);
      router.push("/home/thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      <div>
        <label htmlFor="target" className="field-label">Куди хочеш перевестися <span className="text-brand-500">*</span></label>
        <select id="target" required value={selected} onChange={(e) => setSelected(e.target.value)} className="field-input">
          <option value="" disabled>Обери місце…</option>
          <optgroup label="Цехи і склади">
            {targets.filter((t) => t.kind === "facility").map((t) => (
              <option key={`facility:${t.id}`} value={`facility:${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
          <optgroup label="Магазини">
            {targets.filter((t) => t.kind === "store").map((t) => (
              <option key={`store:${t.id}`} value={`store:${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
        </select>
      </div>
      <div>
        <label htmlFor="comment" className="field-label">Коментар</label>
        <textarea id="comment" placeholder="Чому хочеш перевестися (необов'язково)" value={comment}
          onChange={(e) => setComment(e.target.value)} className="field-textarea" />
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">{error}</div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost px-4">Назад</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? "Відправляємо…" : "Відправити"}
          </button>
        </div>
      </div>
    </form>
  );
}
