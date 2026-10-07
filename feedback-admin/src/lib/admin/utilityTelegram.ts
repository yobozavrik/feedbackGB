export class TelegramError extends Error {
  constructor(public code: string, public retryAfter: number | null = null) { super(code); }
}

/** Telegram sendMediaGroup returns one Message per photo, unlike sendPhoto. */
export async function telegramAlbum(token: string, form: FormData, expected: number): Promise<number[]> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
    method: "POST", body: form, signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json() as { ok?: boolean; error_code?: number;
    parameters?: { retry_after?: number }; result?: Array<{ message_id?: number }> };
  if (!response.ok || !result.ok) {
    throw new TelegramError(`telegram_${result.error_code ?? response.status}`, result.parameters?.retry_after ?? null);
  }
  const messageIds = result.result?.map((message) => message.message_id);
  if (!messageIds || messageIds.length !== expected || messageIds.some((id) => typeof id !== "number")) {
    throw new Error("telegram_album_result_invalid");
  }
  return messageIds as number[];
}
