export function utilityDeliveryConfigured(): boolean {
  if (process.env.UTILITY_READINGS_ENABLED !== "true") return false;
  const transport = process.env.UTILITY_DELIVERY_TRANSPORT ?? "bot_api";
  if (transport === "mtproto") return true;
  if (transport !== "bot_api") return false;
  return !!process.env.TELEGRAM_UTILITY_CHAT_ID?.trim()
    && !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}
