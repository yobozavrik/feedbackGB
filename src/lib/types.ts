import type { CategoryId } from "./categories";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

export interface FeedbackPayload {
  category: CategoryId;
  store?: string;
  fields: Record<string, string | number | null>;
  photo_url?: string | null;
  /** Raw initData string from Telegram WebApp — server validates HMAC. */
  init_data?: string;
}

export interface FeedbackRecord extends FeedbackPayload {
  id: string;
  created_at: string;
  tg_user_id: number | null;
  tg_username: string | null;
  tg_display_name: string | null;
  /** Concatenated, human-readable, AI-friendly summary. */
  summary: string;
}
