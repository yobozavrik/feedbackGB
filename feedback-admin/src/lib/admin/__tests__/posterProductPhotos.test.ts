import { afterEach, describe, expect, it, vi } from "vitest";
import { getPosterCatalogPhotos, getPosterProductPhoto } from "../posterProductPhotos";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe("Poster-sourced catalog photos", () => {
  it("maps list thumbnails only by Poster product ID", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ response: [
      { product_id: "121", photo: "/upload/121.jpeg" },
      { product_id: "122", photo: "" },
      { product_id: "bad", photo: "/upload/bad.jpeg" },
    ] }))) as typeof fetch;
    const photos = await getPosterCatalogPhotos("secret");
    expect([...photos.entries()]).toEqual([[121, "/upload/121.jpeg"], [122, null]]);
  });

  it("uses the current Poster original photo on a product card", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ response: {
      product_id: "121", photo: "/upload/small.jpeg", photo_origin: "/upload/original.jpeg",
    } }))) as typeof fetch;
    expect(await getPosterProductPhoto(121, "secret")).toBe("/upload/original.jpeg");
  });

  it("does not substitute a photo for an absent or mismatched Poster product", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ response: [] }))) as typeof fetch;
    expect(await getPosterProductPhoto(1156, "secret")).toBeNull();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ response: { product_id: "122", photo: "/upload/122.jpeg" } }))) as typeof fetch;
    expect(await getPosterProductPhoto(121, "secret")).toBeNull();
  });
});
