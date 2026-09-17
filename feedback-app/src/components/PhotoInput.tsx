"use client";

import { useRef, useState } from "react";
import { CameraIcon, XIcon } from "@/components/icons";

const THUMB_GRID_SIZE = 8;

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_MAX_OUTPUT_BYTES = 650 * 1024;
const DEFAULT_MAX_PHOTOS = 5;
const COMPRESS_CONCURRENCY = 2;

interface Props {
  label: string;
  maxPhotos?: number;
  /** Decoded JPEG ceiling; photo reports use a tighter ceiling for 15 images. */
  maxOutputBytes?: number;
  maxDimension?: number;
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
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  maxDimension = DEFAULT_MAX_DIMENSION,
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
      // iOS WebViews are particularly sensitive to decoding many full-size
      // camera images at once. Two concurrent canvases keep memory bounded.
      const compressed = await mapWithConcurrency(
        selected,
        COMPRESS_CONCURRENCY,
        (file) => compressImage(file, maxOutputBytes, maxDimension),
      );
      const next = [...previews, ...compressed];
      setPreviews(next);
      onChange(next);
    } catch (e) {
      console.error(e);
      setError("Не вдалося додати фото. Спробуй інше або зроби знімок ще раз.");
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

  // F8: the drop zone always just prompts "add a photo" — the thumbnail
  // grid lives below it, full-size squares instead of 4 sideways slivers
  // squeezed into the same row.
  const overflowCount = previews.length - (THUMB_GRID_SIZE - 1);
  const visibleThumbs = overflowCount > 0 ? previews.slice(0, THUMB_GRID_SIZE - 1) : previews;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="field-label">{label}</label>
        <span className="text-meta tabular-nums text-ink-500">
          {previews.length}/{maxPhotos}
        </span>
      </div>
      <div
        className="flex items-center gap-3 rounded-app border-[1.5px] border-dashed border-ink-300 bg-elev p-3 transition [@media(hover:hover)]:hover:border-brand-500/40"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <CameraIcon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink-900">Додати фото</div>
          <div className="truncate text-meta text-ink-500">
            {busy
              ? "Обробка..."
              : error
                ? error
                : `Камера або галерея · до ${maxPhotos} фото`}
          </div>
        </div>
      </div>
      {previews.length > 0 ? (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {visibleThumbs.map((src, index) => (
            <div key={`${src.slice(0, 32)}-${index}`} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Фото ${index + 1}`}
                className="h-full w-full rounded-[10px] object-cover"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removePhoto(index);
                }}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900/70 text-white"
                aria-label="Видалити фото"
              >
                <XIcon size={13} />
              </button>
            </div>
          ))}
          {overflowCount > 0 ? (
            <div className="flex aspect-square items-center justify-center rounded-[10px] bg-elev2 text-headline text-ink-700">
              +{overflowCount}
            </div>
          ) : null}
        </div>
      ) : null}
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

async function compressImage(
  file: File,
  maxOutputBytes: number,
  maxDimension: number,
): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const ratio = Math.min(
    1,
    maxDimension / Math.max(img.naturalWidth, img.naturalHeight),
  );
  let w = Math.max(1, Math.round(img.naturalWidth * ratio));
  let h = Math.max(1, Math.round(img.naturalHeight * ratio));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // First lower JPEG quality; then reduce dimensions if the camera image is
  // still too large. This gives the 15-photo report a deterministic request
  // budget instead of letting one modern phone exhaust the API body limit.
  while (w >= 320 && h >= 320) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    for (let quality = 0.82; quality >= 0.34; quality -= 0.08) {
      const out = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlByteLength(out) <= maxOutputBytes) return out;
    }
    w = Math.round(w * 0.75);
    h = Math.round(h * 0.75);
  }
  throw new Error("Фото не вдалося стиснути до безпечного розміру");
}

function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64Length = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  return Math.floor((base64Length * 3) / 4) - padding;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
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
