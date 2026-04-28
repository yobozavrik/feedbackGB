import crypto from "node:crypto";
import type { TelegramUser } from "./types";

/**
 * Validate Telegram WebApp `initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Returns the parsed user when valid, or null on failure.
 * If `botToken` is empty (dev mode) we fall back to a permissive parse
 * so the app remains usable locally without a real bot.
 */
export function validateInitData(
  initData: string | undefined,
  botToken: string | undefined,
): { user: TelegramUser | null; valid: boolean } {
  if (!initData) return { user: null, valid: false };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const userJson = params.get("user");
  const user = userJson ? (safeJson<TelegramUser>(userJson) ?? null) : null;

  if (!botToken) {
    return { user, valid: false };
  }
  if (!hash) return { user, valid: false };

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  return { user, valid: computed === hash };
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
