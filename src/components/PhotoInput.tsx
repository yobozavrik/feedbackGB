"use client";

import { useRef, useState } from "react";

const MAX_DIMENSION = 1600;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB after compression

interface Props {
  label: string;
  onChange: (dataUrl: string | null) => void;
}

/**
 * Mobile-friendly photo input. Uses canvas to compress to ≤1600px JPEG before
 * passing back as a data URL — keeps payloads small and avoids needing a
 * separate upload endpoint while still capturing visual evidence.
 */
export function PhotoInput({ label, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      setPreview(compressed);
      onChange(compressed);
    } catch (e) {
      console.error(e);
      setError("Не вдалось обробити фото");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="field-label">{label}</label>
      <div
        className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-blush-200 bg-white/60 p-3"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="preview"
            className="h-20 w-20 flex-shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-xl bg-blush-100 text-3xl">
            📷
          </div>
        )}
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium text-ink-900">
            {preview ? "Замінити фото" : "Додати фото"}
          </div>
          <div className="truncate text-xs text-ink-500">
            {busy
              ? "Обробка..."
              : error
                ? error
                : "Камера або галерея • стискається автоматично"}
          </div>
        </div>
        {preview ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPreview(null);
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-full bg-blush-100 px-2.5 py-1 text-xs font-medium text-blush-600"
          >
            ✕
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
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
  while (out.length > MAX_BYTES && quality > 0.4) {
    quality -= 0.1;
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
