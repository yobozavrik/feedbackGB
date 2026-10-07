import { afterEach, describe, expect, it, vi } from "vitest";
import { telegramAlbum } from "@/lib/admin/utilityTelegram";

afterEach(() => vi.unstubAllGlobals());

describe("Telegram utility photo album", () => {
  it("records every returned message ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, result: [{ message_id: 41 }, { message_id: 42 }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("chat_id", "-100123");
    expect(await telegramAlbum("test-token", form, 2)).toEqual([41, 42]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMediaGroup", expect.objectContaining({ method: "POST", body: form }),
    );
  });

  it("does not report success for an incomplete Telegram response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, result: [{ message_id: 41 }],
    }), { status: 200 })));
    await expect(telegramAlbum("test-token", new FormData(), 2))
      .rejects.toThrow("telegram_album_result_invalid");
  });
});
