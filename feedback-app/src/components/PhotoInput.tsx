"use client";

import { useRef, useState } from "react";
import { CameraIcon, XIcon } from "@/components/icons";
import {
  dataUrlByteLength,
  DEFAULT_MIN_DIMENSION,
  encodeCompressedImage,
  shrinkDimensions,
} from "@/lib/photoCompression";

const THUMB_GRID_SIZE = 8;

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_MAX_OUTPUT_BYTES = 650 * 1024;
const DEFAULT_MAX_PHOTOS = 5;
const COMPRESS_CONCURRENCY = 2;

interface Props {
  label: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  maxPhotos?: number;
  /** Decoded image ceiling; photo reports use a tighter ceiling for 15 images. */
  maxOutputBytes?: number;
  maxDimension?: number;
  minDimension?: number;
  shrinkUntilOnePixel?: boolean;
  separateSources?: boolean;
  onChange: (dataUrls: string[]) => void;
}

/**
 * Mobile-friendly multi-photo input. Uses canvas compression before passing
 * data URLs back to the form, so the existing /api/feedback JSON contract can
 * stay simple while supporting several images.
 */
export function PhotoInput({
  label,
  disabled = false,
  onBusyChange,
  maxPhotos = DEFAULT_MAX_PHOTOS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  maxDimension = DEFAULT_MAX_DIMENSION,
  minDimension = DEFAULT_MIN_DIMENSION,
  shrinkUntilOnePixel = false,
  separateSources = false,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    if (disabled || busy || files.length === 0) return;
    setBusy(true);
    onBusyChange?.(true);
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
        (file) => compressImage(
          file,
          maxOutputBytes,
          maxDimension,
          minDimension,
          shrinkUntilOnePixel,
        ),
      );
      const next = [...previews, ...compressed];
      setPreviews(next);
      onChange(next);
    } catch (e) {
      console.error(e);
      setError("Не вдалося додати фото. Спробуй інше або зроби знімок ще раз.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (inputRef.current) inputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function removePhoto(index: number) {
    if (disabled || busy) return;
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
      {separateSources ? <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || busy || previews.length >= maxPhotos}
          onClick={() => cameraInputRef.current?.click()}
          className="flex min-h-16 items-center justify-center gap-2 rounded-app border-[1.5px] border-dashed border-ink-300 bg-elev p-3 text-ink-900 disabled:opacity-60">
          <CameraIcon size={22} /><span className="text-sm font-semibold">Зробити фото</span>
        </button>
        <button type="button" disabled={disabled || busy || previews.length >= maxPhotos}
          onClick={() => inputRef.current?.click()}
          className="flex min-h-16 items-center justify-center gap-2 rounded-app border-[1.5px] border-dashed border-ink-300 bg-elev p-3 text-ink-900 disabled:opacity-60">
          <span className="text-sm font-semibold">Обрати з галереї</span>
        </button>
      </div> : <div
        className="flex items-center gap-3 rounded-app border-[1.5px] border-dashed border-ink-300 bg-elev p-3 transition [@media(hover:hover)]:hover:border-brand-500/40"
        onClick={() => { if (!disabled && !busy) inputRef.current?.click(); }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || busy}
        onKeyDown={(e) => {
          if (!disabled && !busy && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
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
      </div>}
      {error && separateSources ? <p className="mt-1 text-meta text-danger">{error}</p> : null}
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
                disabled={disabled || busy}
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
        disabled={disabled || busy || (separateSources && previews.length >= maxPhotos)}
        accept="image/*"
        multiple
        capture={separateSources ? undefined : "environment"}
        className="hidden"
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []));
        }}
      />
      {separateSources ? <input
        ref={cameraInputRef}
        type="file"
        disabled={disabled || busy || previews.length >= maxPhotos}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void handleFiles(Array.from(e.target.files ?? [])); }}
      /> : null}
    </div>
  );
}

async function compressImage(
  file: File,
  maxOutputBytes: number,
  maxDimension: number,
  minDimension: number,
  shrinkUntilOnePixel: boolean,
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
  let outputMime: "image/webp" | "image/jpeg" | null = null;

  // First lower image quality; then reduce dimensions if the camera image is
  // still too large. This gives the 15-photo report a deterministic request
  // budget instead of letting one modern phone exhaust the API body limit.
  while (shrinkUntilOnePixel || (w >= minDimension && h >= minDimension)) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    for (let quality = 0.82; quality >= 0.34; quality -= 0.08) {
      const out: string = outputMime === "image/jpeg"
        ? canvas.toDataURL("image/jpeg", quality)
        : encodeCompressedImage(canvas, quality);
      outputMime = out.startsWith("data:image/webp;") ? "image/webp" : "image/jpeg";
      if (dataUrlByteLength(out) <= maxOutputBytes) return out;
    }
    if (!shrinkUntilOnePixel) {
      w = Math.round(w * 0.75);
      h = Math.round(h * 0.75);
      continue;
    }
    const next = shrinkDimensions(w, h, 1);
    if (next.width === w && next.height === h) break;
    w = next.width;
    h = next.height;
  }
  throw new Error("Фото не вдалося стиснути до безпечного розміру");
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
