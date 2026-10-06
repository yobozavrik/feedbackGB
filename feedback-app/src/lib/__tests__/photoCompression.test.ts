import { describe, expect, it, vi } from "vitest";
import {
  dataUrlByteLength,
  DEFAULT_MIN_DIMENSION,
  encodeCompressedImage,
  PHOTO_REPORT_MAX_DIMENSION,
  PHOTO_REPORT_MAX_OUTPUT_BYTES,
  PHOTO_REPORT_MIN_DIMENSION,
  shrinkDimensions,
} from "@/lib/photoCompression";

describe("photo-report emergency compression", () => {
  it("uses WebP only when canvas actually returns a WebP data URL", () => {
    const toDataURL = vi.fn(() => "data:image/webp;base64,UklGRg==");
    const result = encodeCompressedImage({ toDataURL }, 0.82);

    expect(result).toBe("data:image/webp;base64,UklGRg==");
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(toDataURL).toHaveBeenCalledWith("image/webp", 0.82);
  });

  it("uses JPEG rather than Safari's PNG fallback when WebP encoding is unavailable", () => {
    const toDataURL = vi.fn((mime: string) => (
      mime === "image/webp"
        ? "data:image/png;base64,iVBORw0KGgo="
        : "data:image/jpeg;base64,/9j/2Q=="
    ));
    const result = encodeCompressedImage({ toDataURL }, 0.5);

    expect(result).toBe("data:image/jpeg;base64,/9j/2Q==");
    expect(toDataURL).toHaveBeenNthCalledWith(1, "image/webp", 0.5);
    expect(toDataURL).toHaveBeenNthCalledWith(2, "image/jpeg", 0.5);
  });

  it("uses JPEG when the WebP encoder throws", () => {
    const toDataURL = vi.fn((mime: string) => {
      if (mime === "image/webp") throw new Error("WebP encoder unavailable");
      return "data:image/jpeg;base64,/9j/2Q==";
    });

    expect(encodeCompressedImage({ toDataURL }, 0.34)).toBe("data:image/jpeg;base64,/9j/2Q==");
    expect(toDataURL).toHaveBeenNthCalledWith(2, "image/jpeg", 0.34);
  });

  it("measures decoded base64 bytes rather than the data URL string length", () => {
    expect(dataUrlByteLength("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(dataUrlByteLength("data:image/jpeg;base64,AA==")).toBe(1);
    expect(dataUrlByteLength("data:image/jpeg;base64,AAA=")).toBe(2);
  });

  it("keeps the approved temporary limits", () => {
    expect(PHOTO_REPORT_MAX_OUTPUT_BYTES).toBe(50 * 1024);
    expect(PHOTO_REPORT_MAX_DIMENSION).toBe(768);
    expect(PHOTO_REPORT_MIN_DIMENSION).toBe(1);
    expect(DEFAULT_MIN_DIMENSION).toBe(320);
  });

  it("can shrink an emergency photo to one pixel without entering a zero-size loop", () => {
    expect(shrinkDimensions(2, 2, 1)).toEqual({ width: 1, height: 1 });
    expect(shrinkDimensions(1, 1, 1)).toEqual({ width: 1, height: 1 });
    expect(shrinkDimensions(160, 96, 1)).toEqual({ width: 120, height: 72 });
  });
});
