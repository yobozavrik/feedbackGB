import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage, validateInitData } from "../telegram";

const BOT_TOKEN = "123456:test-bot-token";

/** Mirrors the production HMAC algorithm to build a valid fixture. */
function signInitData(params: Record<string, string>, botToken: string): string {
  const search = new URLSearchParams(params);
  const dataCheckString = [...search.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  search.set("hash", hash);
  return search.toString();
}

describe("validateInitData", () => {
  it("returns invalid with no user when initData is undefined", () => {
    expect(validateInitData(undefined, BOT_TOKEN)).toEqual({
      user: null,
      valid: false,
    });
  });

  it("parses the user but stays invalid when botToken is empty (dev mode)", () => {
    const initData = signInitData(
      { user: JSON.stringify({ id: 1, first_name: "Test" }), auth_date: "1000" },
      BOT_TOKEN,
    );
    const result = validateInitData(initData, undefined);
    expect(result.valid).toBe(false);
    expect(result.user).toEqual({ id: 1, first_name: "Test" });
  });

  it("is invalid when the hash param is missing", () => {
    const params = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: "Test" }),
      auth_date: "1000",
    });
    const result = validateInitData(params.toString(), BOT_TOKEN);
    expect(result.valid).toBe(false);
  });

  it("is valid for a correctly HMAC-signed initData string", () => {
    const initData = signInitData(
      { user: JSON.stringify({ id: 42, first_name: "Оля" }), auth_date: "1700000000" },
      BOT_TOKEN,
    );
    const result = validateInitData(initData, BOT_TOKEN);
    expect(result.valid).toBe(true);
    expect(result.user).toEqual({ id: 42, first_name: "Оля" });
  });

  it("is invalid when the payload was tampered with after signing", () => {
    const initData = signInitData(
      { user: JSON.stringify({ id: 42, first_name: "Оля" }), auth_date: "1700000000" },
      BOT_TOKEN,
    );
    // Attacker flips auth_date after the hash was computed.
    const tampered = initData.replace("auth_date=1700000000", "auth_date=1700099999");
    const result = validateInitData(tampered, BOT_TOKEN);
    expect(result.valid).toBe(false);
  });

  it("is invalid when signed with a different bot token", () => {
    const initData = signInitData(
      { user: JSON.stringify({ id: 42, first_name: "Оля" }), auth_date: "1700000000" },
      BOT_TOKEN,
    );
    const result = validateInitData(initData, "different-token");
    expect(result.valid).toBe(false);
  });

  it("returns user: null when the user field is malformed JSON", () => {
    const initData = signInitData({ user: "{not-json", auth_date: "1000" }, BOT_TOKEN);
    const result = validateInitData(initData, BOT_TOKEN);
    expect(result.user).toBeNull();
    // Hash still matches what was actually signed, so validity is unaffected
    // by the user field being unparsable.
    expect(result.valid).toBe(true);
  });
});

describe("sendTelegramMessage", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns true and posts the expected payload on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = fetchMock as any;

    const ok = await sendTelegramMessage(BOT_TOKEN, "-1001", "<b>hello</b>");

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: "-1001",
          text: "<b>hello</b>",
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }),
    );
  });

  it("returns false and logs when Telegram responds with a non-ok status", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request: chat not found",
    }) as any;

    const ok = await sendTelegramMessage(BOT_TOKEN, "-1001", "hi");

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "sendTelegramMessage failed",
      expect.objectContaining({ status: 400 }),
    );
  });

  it("returns false and logs when fetch throws (network error)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as any;

    const ok = await sendTelegramMessage(BOT_TOKEN, "-1001", "hi");

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "sendTelegramMessage error",
      expect.any(Error),
    );
  });
});
