/** Temporary emergency limits for photo_report only. */
export const PHOTO_REPORT_MAX_OUTPUT_BYTES = 50 * 1024;
export const PHOTO_REPORT_MAX_DIMENSION = 768;
export const PHOTO_REPORT_MIN_DIMENSION = 160;
export const DEFAULT_MIN_DIMENSION = 320;

type CanvasEncoder = Pick<HTMLCanvasElement, "toDataURL">;

/**
 * Safari/iOS can return PNG when asked to encode WebP. Treat WebP as supported
 * only when the returned data URL proves it, otherwise encode JPEG explicitly.
 */
export function encodeCompressedImage(
  canvas: CanvasEncoder,
  quality: number,
): string {
  try {
    const webp = canvas.toDataURL("image/webp", quality);
    if (webp.startsWith("data:image/webp;")) return webp;
  } catch {
    // An encoder failure must not prevent the explicit JPEG fallback.
  }
  return canvas.toDataURL("image/jpeg", quality);
}

/** Returns decoded bytes represented by a base64 data URL. */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64Length = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  return Math.floor((base64Length * 3) / 4) - padding;
}
