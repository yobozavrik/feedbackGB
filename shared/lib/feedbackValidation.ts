import { getCategory, CATEGORIES, type Category } from "./categories";
import { HR_TOPICS } from "./hrTopics";
import type { FeedbackPayload } from "./types";

// Pure payload validation for POST /api/feedback. No I/O, no framework
// imports — every rule the route enforced inline lives here verbatim, in
// the same order and with the same error strings, so the route's external
// contract is unchanged.

const VALID_CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const MAX_PHOTOS = 5;
const MAX_FIELD_LEN = 4000;
const MAX_FIELDS = 40;
const MAX_STORE_LABEL_LEN = 80;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HR_TOPIC_IDS = new Set(HR_TOPICS.map((t) => t.id));
// HR topics that collect a date_from/date_to range and require the same
// "at least N days notice" rule (vacation, day off). Other topics
// (sick leave, resignation, transfer) don't use this shape.
const HR_DATE_RANGE_TOPICS = new Set(["vacation", "day-off"]);
const HR_DATE_RANGE_MIN_NOTICE_DAYS = 7;
const MAX_CART_ITEMS = 100;

export interface ValidatedFeedback {
  category: Category;
  cleanFields: Record<string, string | number | null>;
  storeLabel: string | null;
  clientSubmissionId: string | null;
  clientCreatedAt: string | null;
  productId: number | null;
  quantity: number | null;
  cartItems: Array<{ product_id: number; quantity: number }> | null;
  /** Raw photo candidates; per-entry sanitisation happens at upload time. */
  rawPhotos: unknown[];
}

export type FeedbackValidationResult =
  | { ok: true; data: ValidatedFeedback }
  | { ok: false; error: string; status: number };

export function validateFeedbackPayload(
  payload: FeedbackPayload,
): FeedbackValidationResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid payload", status: 400 };
  }

  if (!payload.category || !VALID_CATEGORY_IDS.has(payload.category)) {
    return { ok: false, error: "Unknown category", status: 400 };
  }
  const category = getCategory(payload.category)!;

  // Required-field check + shape / length validation.
  const cleanFields: Record<string, string | number | null> = {};
  const incomingFields = (payload.fields ?? {}) as Record<string, unknown>;
  if (typeof incomingFields !== "object" || Array.isArray(incomingFields)) {
    return { ok: false, error: "Invalid fields", status: 400 };
  }
  const fieldKeys = Object.keys(incomingFields);
  if (fieldKeys.length > MAX_FIELDS) {
    return { ok: false, error: "Too many fields", status: 400 };
  }
  for (const key of fieldKeys) {
    const v = incomingFields[key];
    if (v === null || v === undefined) {
      cleanFields[key] = null;
      continue;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        return { ok: false, error: `Invalid number: ${key}`, status: 400 };
      }
      cleanFields[key] = v;
      continue;
    }
    if (typeof v === "string") {
      if (v.length > MAX_FIELD_LEN) {
        return { ok: false, error: `Field too long: ${key}`, status: 400 };
      }
      cleanFields[key] = v;
      continue;
    }
    return { ok: false, error: `Invalid field type: ${key}`, status: 400 };
  }

  for (const f of category.fields) {
    if (f.kind === "photo" || !f.required) continue;
    // Consumables now use the structured cart, not the legacy free-text
    // materials_list field kept in the category definition for old records.
    if (category.id === "consumables_request" && f.id === "materials_list") continue;
    const v = cleanFields[f.id];
    if (v === undefined || v === null || `${v}`.trim() === "") {
      return {
        ok: false,
        error: `Missing required field: ${f.id}`,
        status: 400,
      };
    }
  }

  const storeLabel =
    typeof payload.store_label === "string" && payload.store_label.trim()
      ? payload.store_label.trim().slice(0, MAX_STORE_LABEL_LEN)
      : null;

  let clientSubmissionId: string | null = null;
  if (payload.client_submission_id !== undefined && payload.client_submission_id !== null) {
    if (
      typeof payload.client_submission_id !== "string" ||
      !UUID_REGEX.test(payload.client_submission_id)
    ) {
      return { ok: false, error: "Invalid client_submission_id", status: 400 };
    }
    clientSubmissionId = payload.client_submission_id;
  }

  let clientCreatedAt: string | null = null;
  if (payload.client_created_at !== undefined && payload.client_created_at !== null) {
    if (typeof payload.client_created_at !== "string") {
      return { ok: false, error: "Invalid client_created_at", status: 400 };
    }
    const parsedDate = Date.parse(payload.client_created_at);
    if (Number.isNaN(parsedDate)) {
      return {
        ok: false,
        error: "Неправильний формат часу створення відгуку",
        status: 400,
      };
    }
    if (parsedDate > Date.now() + 5 * 60 * 1000) {
      return {
        ok: false,
        error: "Час створення відгуку не може бути у майбутньому",
        status: 400,
      };
    }
    clientCreatedAt = payload.client_created_at;
  }

  // v1 priority flow: structured product reference + quantity.
  // product_id is a bigint PK from categories.products; we accept any positive
  // integer and let Postgres reject unknown FKs.
  const productId =
    typeof payload.product_id === "number" &&
    Number.isFinite(payload.product_id) &&
    payload.product_id > 0 &&
    Number.isInteger(payload.product_id)
      ? payload.product_id
      : null;

  const quantity =
    typeof payload.quantity === "number" &&
    Number.isFinite(payload.quantity) &&
    payload.quantity >= 0 &&
    payload.quantity <= 1_000_000
      ? payload.quantity
      : null;

  // v1 priority categories: new product-picker UI submits
  //   { product_id, quantity, fields: { comment?, photo? } }
  // while the legacy UI still submits { fields: { item_name, ... } }.
  // We accept either shape, but when product_id is set (modern flow)
  // we require a positive quantity to keep data clean.
  if (category.requiresProduct) {
    const itemName =
      typeof cleanFields["item_name"] === "string"
        ? (cleanFields["item_name"] as string).trim()
        : "";
    if (!productId && !itemName) {
      return { ok: false, error: "Обери товар або введи назву", status: 400 };
    }
  }
  if (productId !== null && category.requiresQuantity) {
    if (quantity === null || quantity <= 0) {
      return { ok: false, error: "Вкажи кількість", status: 400 };
    }
  }

  let cartItems: Array<{ product_id: number; quantity: number }> | null = null;
  if (category.id === "consumables_request") {
    if (!Array.isArray(payload.cart_items) || payload.cart_items.length === 0) {
      return { ok: false, error: "Додай хоча б один розхідний матеріал", status: 400 };
    }
    if (payload.cart_items.length > MAX_CART_ITEMS) {
      return { ok: false, error: `Забагато позицій: максимум ${MAX_CART_ITEMS}`, status: 400 };
    }
    const seen = new Set<number>();
    cartItems = [];
    for (const item of payload.cart_items) {
      const productId = item?.product_id;
      const quantity = item?.quantity;
      if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
        return { ok: false, error: "Некоректна позиція кошика", status: 400 };
      }
      if (seen.has(productId)) {
        return { ok: false, error: "Одна позиція не може бути в кошику двічі", status: 400 };
      }
      seen.add(productId);
      cartItems.push({ product_id: productId, quantity: Math.round(quantity * 1000) / 1000 });
    }
  } else if (payload.cart_items !== undefined) {
    return { ok: false, error: "Кошик доступний лише для заявки на розхідні матеріали", status: 400 };
  }

  if (category.id === "hr_question") {
    const hrTopic =
      typeof cleanFields["hr_topic"] === "string"
        ? (cleanFields["hr_topic"] as string).trim()
        : "";
    if (!HR_TOPIC_IDS.has(hrTopic)) {
      return { ok: false, error: "Невідома тема HR-питання", status: 400 };
    }

    if (HR_DATE_RANGE_TOPICS.has(hrTopic)) {
      const dateFrom =
        typeof cleanFields["date_from"] === "string" ? cleanFields["date_from"] : "";
      const dateTo =
        typeof cleanFields["date_to"] === "string" ? cleanFields["date_to"] : "";
      if (!DATE_ONLY_REGEX.test(dateFrom) || !DATE_ONLY_REGEX.test(dateTo)) {
        return { ok: false, error: "Невірний формат дати", status: 400 };
      }
      const from = new Date(`${dateFrom}T00:00:00Z`);
      const to = new Date(`${dateTo}T00:00:00Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return { ok: false, error: "Невірна дата", status: 400 };
      }
      if (to < from) {
        return {
          ok: false,
          error: "Дата закінчення не може бути раніше дати початку",
          status: 400,
        };
      }
      const now = new Date();
      const todayUtc = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const minStart = new Date(todayUtc);
      minStart.setUTCDate(minStart.getUTCDate() + HR_DATE_RANGE_MIN_NOTICE_DAYS);
      if (from < minStart) {
        return {
          ok: false,
          error: `Заявку потрібно подавати щонайменше за ${HR_DATE_RANGE_MIN_NOTICE_DAYS} днів до дати початку`,
          status: 400,
        };
      }
    }

    // Sick leave: no advance-notice rule (illness isn't scheduled), and the
    // end date is optional — duration is often unknown at filing time.
    if (hrTopic === "sick-leave") {
      const dateFrom =
        typeof cleanFields["date_from"] === "string" ? cleanFields["date_from"] : "";
      if (!DATE_ONLY_REGEX.test(dateFrom)) {
        return { ok: false, error: "Невірний формат дати", status: 400 };
      }
      const dateTo = cleanFields["date_to"];
      if (typeof dateTo === "string" && dateTo) {
        if (!DATE_ONLY_REGEX.test(dateTo)) {
          return { ok: false, error: "Невірний формат дати", status: 400 };
        }
        const from = new Date(`${dateFrom}T00:00:00Z`);
        const to = new Date(`${dateTo}T00:00:00Z`);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          return { ok: false, error: "Невірна дата", status: 400 };
        }
        if (to < from) {
          return {
            ok: false,
            error: "Дата закінчення не може бути раніше дати початку",
            status: 400,
          };
        }
      }
    }

    // Resignation: the 2-week statutory notice is a soft, client-side-only
    // warning (per product decision) — server only rejects a resignation
    // date that's already in the past, not a short-notice date.
    if (hrTopic === "resignation") {
      const dateFrom =
        typeof cleanFields["date_from"] === "string" ? cleanFields["date_from"] : "";
      if (!DATE_ONLY_REGEX.test(dateFrom)) {
        return { ok: false, error: "Невірний формат дати", status: 400 };
      }
      const from = new Date(`${dateFrom}T00:00:00Z`);
      if (Number.isNaN(from.getTime())) {
        return { ok: false, error: "Невірна дата", status: 400 };
      }
      const now = new Date();
      const todayUtc = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      if (from < todayUtc) {
        return {
          ok: false,
          error: "Дата звільнення не може бути в минулому",
          status: 400,
        };
      }
    }

    if (hrTopic === "transfer") {
      // Sellers pick a store (target_store_id, int); supply workers pick a
      // facility (target_facility_id, uuid). Exactly one must be present —
      // the server resolves the human-readable name from the id, never trusts
      // a client-supplied *_name label.
      const targetStoreId = cleanFields["target_store_id"];
      const targetFacilityId = cleanFields["target_facility_id"];
      const hasStore =
        typeof targetStoreId === "number" &&
        Number.isInteger(targetStoreId) &&
        targetStoreId > 0;
      const hasFacility =
        typeof targetFacilityId === "string" && UUID_REGEX.test(targetFacilityId);
      if (hasStore === hasFacility) {
        // neither, or both
        return { ok: false, error: "Обери магазин/цех для переведення", status: 400 };
      }
    }
  }

  const rawPhotos: unknown[] = Array.isArray(payload.photo_urls)
    ? payload.photo_urls
    : typeof payload.photo_url === "string"
      ? [payload.photo_url]
      : [];
  if (rawPhotos.length > MAX_PHOTOS) {
    return {
      ok: false,
      error: `Too many photos: max ${MAX_PHOTOS}`,
      status: 400,
    };
  }

  return {
    ok: true,
    data: {
      category,
      cleanFields,
      storeLabel,
      clientSubmissionId,
      clientCreatedAt,
      productId,
      quantity,
      cartItems,
      rawPhotos,
    },
  };
}
