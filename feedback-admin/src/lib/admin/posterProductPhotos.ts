import { posterRequest, PosterApiError } from "./posterApi";

type PosterPhotoProduct = {
  product_id?: string | number;
  photo?: string | null;
  photo_origin?: string | null;
};

function photoPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  return path || null;
}

/** Current Poster IDs and their Poster-sourced photos; null means no photo. */
export async function getPosterCatalogPhotos(token: string): Promise<Map<number, string | null>> {
  const rows = await posterRequest<PosterPhotoProduct[]>("menu.getProducts", {}, token);
  if (!Array.isArray(rows)) throw new PosterApiError("poster_invalid_response");
  const photos = new Map<number, string | null>();
  for (const row of rows) {
    const id = Number(row.product_id);
    const photo = photoPath(row.photo);
    if (Number.isSafeInteger(id) && id > 0) photos.set(id, photo);
  }
  return photos;
}

export async function getPosterProductPhoto(productId: number, token: string): Promise<string | null> {
  const row = await posterRequest<PosterPhotoProduct | unknown[]>("menu.getProduct", { product_id: String(productId) }, token);
  if (!row || Array.isArray(row) || Number(row.product_id) !== productId) return null;
  return photoPath(row.photo_origin) ?? photoPath(row.photo);
}
