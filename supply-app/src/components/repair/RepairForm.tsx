"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 5;

type Urgency = "critical" | "medium" | "normal";
const URGENCY_OPTIONS: Array<{ value: Urgency; label: string; hint: string }> = [
  { value: "critical", label: "Критична", hint: "цех стоїть" },
  { value: "medium", label: "Середня", hint: "можемо працювати, але погано" },
  { value: "normal", label: "Звичайна", hint: "планова заміна" },
];

/** RepairForm — supply-side tech_issue submission. */
export function RepairForm() {
  const router = useRouter();
  const [equipment, setEquipment] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (photos.length + files.length > MAX_PHOTOS) {
      setError(`Максимум ${MAX_PHOTOS} фото`);
      return;
    }
    for (const file of files) {
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`Фото "${file.name}" завелике (макс. 5 МБ)`);
        return;
      }
    }
    setError(null);
    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read"));
            reader.onerror = () => reject(reader.error ?? new Error("read"));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((dataUrls) => setPhotos((prev) => [...prev, ...dataUrls]))
      .catch(() => setError("Не вдалося прочитати фото"));
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) {
      setError("Опиши, що сталось");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      category: "tech_issue",
      fields: {
        // matches shared/lib/categories.ts tech_issue schema
        what_broken: equipment.trim() || null,
        urgency, // stored as enum value; label is UI-only
        details: description.trim(),
      },
      client_submission_id: crypto.randomUUID(),
      client_created_at: new Date().toISOString(),
    };
    if (photos.length > 0) body.photo_urls = photos;

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Не вдалося відправити");
      }
      router.push("/home/thanks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      <div>
        <label htmlFor="equipment" className="field-label">
          Обладнання / вузол
        </label>
        <input
          id="equipment"
          type="text"
          maxLength={120}
          placeholder="Наприклад: піч № 2, термінал Кварц"
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
          className="field-input"
        />
      </div>

      <div>
        <label htmlFor="description" className="field-label">
          Опис проблеми <span className="text-brand-500">*</span>
        </label>
        <textarea
          id="description"
          required
          placeholder="Що сталось, коли, як проявляється"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="field-textarea"
        />
      </div>

      <div>
        <p className="field-label">Терміновість</p>
        <div className="grid gap-2">
          {URGENCY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                urgency === opt.value
                  ? "border-brand-500 bg-brand-50"
                  : "border-ink-300/45 bg-elev"
              }`}
            >
              <input
                type="radio"
                name="urgency"
                value={opt.value}
                checked={urgency === opt.value}
                onChange={() => setUrgency(opt.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-[14px] font-semibold text-ink-900">{opt.label}</span>
                <span className="block text-[12px] text-ink-500">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="field-label">Фото (до {MAX_PHOTOS})</p>
        {photos.length > 0 ? (
          <div className="mb-2 grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p}
                  alt=""
                  className="h-24 w-full rounded-lg border border-ink-300/20 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label="Видалити фото"
                  className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {photos.length < MAX_PHOTOS ? (
          <input
            id="photo-input"
            type="file"
            accept="image/*"
            multiple
            onChange={onFiles}
            className="block w-full text-[13px] text-ink-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-500"
          />
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600"
        >
          {error}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost px-4">
            Назад
          </button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? "Відправляємо…" : "Відправити"}
          </button>
        </div>
      </div>
    </form>
  );
}
