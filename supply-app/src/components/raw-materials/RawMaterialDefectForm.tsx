"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QuantityStepper } from "@/components/QuantityStepper";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 5;

const UNIT_LABEL: Record<string, string> = {
  kg: "кг",
  liter: "л",
  piece: "шт",
};

interface Ingredient {
  id: string;
  name: string;
  unit: string;
}

/** RawMaterialDefectForm — supply-side raw_material_defect submission, mirrors
 * feedback-app's PriorityFeedbackForm defect flow: pick item → quantity →
 * defect type → required comment → photo → submit. */
export function RawMaterialDefectForm() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Ingredient[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [ingredient, setIngredient] = useState<Ingredient | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [defectType, setDefectType] = useState("");
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/supply/raw-materials/catalog")
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data: { items?: Ingredient[] }) => setCatalog(data.items ?? []))
      .catch(() => setCatalog([]));
  }, []);

  const filtered = (catalog ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function pickIngredient(item: Ingredient) {
    setIngredient(item);
    setPickerOpen(false);
    setSearch("");
  }

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
    if (!ingredient) {
      setError("Обери інгредієнт");
      return;
    }
    if (quantity <= 0) {
      setError("Кількість має бути більше 0");
      return;
    }
    if (!comment.trim()) {
      setError("Опиши, що саме не так");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      category: "raw_material_defect",
      fields: {
        product_name: ingredient.name,
        product_unit: UNIT_LABEL[ingredient.unit] ?? ingredient.unit,
        quantity,
        defect_type: defectType.trim() || null,
        comment: comment.trim(),
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
      router.push("/home/thanks?cat=raw_material_defect");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card animate-fade-up space-y-4 p-5 pb-24">
      <div>
        <p className="field-label">Який інгредієнт?</p>
        {ingredient ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-between rounded-lg border border-ink-300/45 bg-elev p-3 text-left hover:border-brand-500/40"
          >
            <span>
              <span className="block font-medium text-ink-900">{ingredient.name}</span>
              <span className="block text-[12px] text-ink-500">{UNIT_LABEL[ingredient.unit] ?? ingredient.unit}</span>
            </span>
            <span className="text-[12px] font-medium text-brand-600">Змінити</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-300/45 bg-elev2 px-4 text-[15px] font-medium text-ink-700 hover:border-brand-500/40 hover:text-brand-600"
          >
            <span aria-hidden>＋</span> Обрати інгредієнт
          </button>
        )}
      </div>

      {ingredient ? (
        <QuantityStepper value={quantity} onChange={setQuantity} min={0} step={1} unit={UNIT_LABEL[ingredient.unit] ?? ingredient.unit} label="Скільки браку" />
      ) : null}

      <div>
        <label htmlFor="defect_type" className="field-label">
          Що саме з нею не так?
        </label>
        <input
          id="defect_type"
          type="text"
          maxLength={120}
          placeholder="Прострочена / зіпсована / пошкоджена упаковка"
          value={defectType}
          onChange={(e) => setDefectType(e.target.value)}
          className="field-input"
        />
      </div>

      <div>
        <label htmlFor="comment" className="field-label">
          Деталі <span className="text-brand-500">*</span>
        </label>
        <textarea
          id="comment"
          required
          maxLength={1000}
          placeholder="Коли помітили, які ознаки, скільки партія"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="field-textarea"
        />
      </div>

      <div>
        <p className="field-label">Фото браку (дуже бажано)</p>
        {photos.length > 0 ? (
          <div className="mb-2 grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="" className="h-24 w-full rounded-lg border border-ink-300/20 object-cover" />
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
            type="file"
            accept="image/*"
            multiple
            onChange={onFiles}
            className="block w-full text-[13px] text-ink-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-500"
          />
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">
          {error}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300/20 bg-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-md gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost px-4">
            Назад
          </button>
          <button type="submit" disabled={busy || !ingredient} className="btn-primary flex-1">
            {busy ? "Відправляємо…" : "Відправити"}
          </button>
        </div>
      </div>

      {pickerOpen ? (
        <div className="fixed inset-0 z-30 flex flex-col bg-bg">
          <div className="flex items-center gap-2 border-b border-ink-300/20 p-4">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук за назвою"
              className="field-input flex-1"
            />
            <button type="button" onClick={() => setPickerOpen(false)} className="btn-ghost px-4">
              Скасувати
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {catalog === null ? (
              <p className="py-8 text-center text-[13px] text-ink-500">Завантаження…</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-500">Нічого не знайдено</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => pickIngredient(item)}
                    className="flex h-14 w-full items-center justify-between rounded-xl border border-ink-300/20 bg-elev px-4 text-left shadow-soft active:scale-[0.98]"
                  >
                    <span className="truncate text-[15px] text-ink-900">{item.name}</span>
                    <span className="whitespace-nowrap text-[13px] text-ink-500">
                      {UNIT_LABEL[item.unit] ?? item.unit}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </form>
  );
}
