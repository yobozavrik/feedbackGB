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
  /** FK to feedbackgb.stores; null when "Не вказувати" or "Інший". */
  store_id?: number | null;
  /** Free-form store label (used when store_id is null and user picked "Інший"). */
  store_label?: string | null;
  /**
   * v1 priority flow: FK to categories.products(id). Required for
   * missing_item / overstock / defect (unless the seller types a name
   * outside the POS catalog via `fields.item_name`).
   */
  product_id?: number | null;
  /** v1 priority flow: numeric quantity (units of the product). */
  quantity?: number | null;
  /** Structured consumables cart. Valid only for consumables_request. */
  cart_items?: Array<{ product_id: number; quantity: number }>;
  fields: Record<string, string | number | string[] | null>;
  photo_url?: string | null;
  photo_urls?: string[];
  /** Raw initData string from Telegram WebApp — server validates HMAC. */
  init_data?: string;
  client_submission_id?: string;
  client_created_at?: string;
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
