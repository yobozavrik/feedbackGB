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

  // v1 priority flow: render product + quantity as a leading, compact
  // phrase before the per-field breakdown (e.g. "Пельмені «Селянські» · 3 шт").
  const fields = { ...(payload.fields ?? {}) };
  const productName =
    typeof fields.product_name === "string" ? fields.product_name.trim() : "";
  const productUnit =
    typeof fields.product_unit === "string" ? fields.product_unit.trim() : "";
  const qtyRaw = fields.quantity ?? payload.quantity ?? null;
  const quantity =
    typeof qtyRaw === "number" && Number.isFinite(qtyRaw)
      ? qtyRaw
      : typeof qtyRaw === "string" && qtyRaw.trim() !== "" && !Number.isNaN(Number(qtyRaw))
        ? Number(qtyRaw)
        : null;

  // Hide these from the generic per-field dump; they're rendered in the head.
  delete fields.product_name;
  delete fields.product_unit;
  delete fields.quantity;

  let head = "";
  if (productName) {
    head = ` — ${productName}`;
    if (quantity !== null) {
      head += ` · ${quantity}${productUnit ? ` ${productUnit}` : ""}`;
    }
  } else if (quantity !== null) {
    head = ` — кількість: ${quantity}${productUnit ? ` ${productUnit}` : ""}`;
  }

  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === "") continue;
    const fieldLabel = cat?.fields.find((f) => f.id === k)?.label ?? k;
    parts.push(`${fieldLabel}: ${String(v).trim()}`);
  }

  const body = parts.length ? `${head ? ";" : " —"} ${parts.join("; ")}` : "";
  const photo = payload.photo_url ? ` [фото: ${payload.photo_url}]` : "";
  return `${catLabel}${store}${who}${head}${body}${photo}`;
}
