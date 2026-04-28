import { getCategory } from "./categories";
import type { FeedbackPayload } from "./types";

/**
 * Build a single readable string per feedback record.
 * This is what the AI agent / analyst will scan or vectorize.
 *
 * Format:
 *   [Категорія] (магазин: <name>) від <user> — поле: значення; поле: значення
 */
export function buildSummary(
  payload: FeedbackPayload,
  user: { display_name?: string | null; username?: string | null } = {},
  storeName?: string | null,
): string {
  const cat = getCategory(payload.category);
  const catLabel = cat ? `${cat.emoji} ${cat.title}` : payload.category;
  const who =
    user.display_name || user.username
      ? ` від ${[user.display_name, user.username && `@${user.username}`]
          .filter(Boolean)
          .join(" ")}`
      : "";
  const storeText = storeName || payload.store_label;
  const store = storeText ? ` (магазин: ${storeText})` : "";

  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload.fields ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    const fieldLabel = cat?.fields.find((f) => f.id === k)?.label ?? k;
    parts.push(`${fieldLabel}: ${String(v).trim()}`);
  }

  const body = parts.length ? ` — ${parts.join("; ")}` : "";
  const photo = payload.photo_url ? ` [фото: ${payload.photo_url}]` : "";
  return `${catLabel}${store}${who}${body}${photo}`;
}
