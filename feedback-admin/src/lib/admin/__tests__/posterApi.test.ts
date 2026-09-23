import { afterEach, describe, expect, it, vi } from "vitest";
import { posterRequest } from "../posterApi";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe("Poster server client", () => {
  it("never leaks the token from network errors", async () => {
    global.fetch = vi.fn(async () => { throw new Error("https://joinposter.com/api/menu.getProduct?token=private-token"); }) as typeof fetch;
    await expect(posterRequest("menu.getProduct", { product_id: "121" }, "private-token"))
      .rejects.toMatchObject({ code: "poster_unavailable", message: "poster_unavailable" });
  });

  it("never returns a Poster error body containing the token", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "private-token" }), { status: 200 })) as typeof fetch;
    await expect(posterRequest("menu.getProduct", { product_id: "121" }, "private-token"))
      .rejects.toMatchObject({ code: "poster_invalid_response", message: "poster_invalid_response" });
  });

  it("handles a null Poster response as a sanitized error", async () => {
    global.fetch = vi.fn(async () => new Response("null", { status: 200 })) as typeof fetch;
    await expect(posterRequest("menu.getProduct", { product_id: "121" }, "private-token"))
      .rejects.toMatchObject({ code: "poster_invalid_response" });
  });
});
