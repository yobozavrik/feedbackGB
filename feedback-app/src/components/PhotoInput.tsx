"use client";

import { useRef, useState } from "react";

const MAX_DIMENSION = 1600;
const MAX_BYTES = 900 * 1024; // keep multi-photo JSON payloads small
const DEFAULT_MAX_PHOTOS = 5;

interface Props {
  label: string;
  maxPhotos?: number;
  onChange: (dataUrls: string[]) => void;
}

/**
 * Mobile-friendly multi-photo input. Uses canvas compression before passing
 * data URLs back to the form, so the existing /api/feedback JSON contract can
 * stay simple while supporting several images.
 */
export function PhotoInput({
  label,
  maxPhotos = DEFAULT_MAX_PHOTOS,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const slots = Math.max(0, maxPhotos - previews.length);
      const selected = files.slice(0, slots);
      if (selected.length < files.length) {
        setError(`Можна додати максимум ${maxPhotos} фото`);
      }
      const compressed = await Promise.all(
        selected.map((file) => compressImage(file)),
      );
      const next = [...previews, ...compressed];
      setPreviews(next);
      onChange(next);
    } catch (e) {
      console.error(e);
      setError("Не вдалося обробити фото");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removePhoto(index: number) {
    const next = previews.filter((_, i) => i !== index);
    setPreviews(next);
    onChange(next);
  }

  return (
    <div>
      <label className="field-label">{label}</label>
      <div
        className="flex items-center gap-3 rounded-lg border-2 border-dashed border-ink-300/45 bg-elev2 p-3 transition hover:border-brand-500/40"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        {previews.length > 0 ? (
          <div className="grid max-w-[148px] flex-shrink-0 grid-cols-2 gap-1">
            {previews.slice(0, 4).map((src, index) => (
              <div key={`${src.slice(0, 32)}-${index}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`preview ${index + 1}`}
                  className="h-[34px] w-[68px] rounded-md object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePhoto(index);
                  }}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white shadow-soft"
                  aria-label="Видалити фото"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-elev text-3xl">
            📷
          </div>
        )}
        <div className="min-w-0 flex-1 text-[14px]">
          <div className="font-medium text-ink-900">
            {previews.length > 0
              ? `Додано ${previews.length}/${maxPhotos} фото`
              : "Додати фото"}
          </div>
          <div className="truncate text-[12px] text-ink-500">
            {busy
              ? "Обробка..."
              : error
                ? error
                : "Камера або галерея, можна кілька фото"}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []));
        }}
      />
    </div>
  );
}

async function compressImage(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const ratio = Math.min(
    1,
    MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.round(img.naturalWidth * ratio);
  const h = Math.round(img.naturalHeight * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);

  let quality = 0.82;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > MAX_BYTES && quality > 0.35) {
    quality -= 0.08;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
