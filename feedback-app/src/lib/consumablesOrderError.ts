// Classifies why the warehouse CRM refused a consumables order, so the API
// can return a message the seller can act on instead of a generic 502.
//
// Two failure shapes come back from rpc_create_feedbackgb_consumables_order:
//   * A handled refusal — the RPC RETURNs { success:false, error:'…' }.
//     Currently only "FeedbackGB store is not mapped to a CRM shop".
//   * An unhandled RAISE EXCEPTION — surfaces as supabase-js `error` with a
//     `message`. The one we can act on is "Invalid FeedbackGB cart item"
//     (a product went inactive between catalog load and submit).
// Anything else stays a generic 502 (transient / unknown).

export interface ConsumablesCrmFailure {
  status: number;
  /** Ukrainian, seller-facing. */
  error: string;
  /** Whether the caller should log the store_id (helps chase mapping gaps). */
  logStoreId: boolean;
}

export function classifyConsumablesCrmFailure(
  crmError: { message?: string } | null | undefined,
  crm: { error?: string } | null | undefined,
): ConsumablesCrmFailure {
  const msg = (crmError?.message ?? crm?.error ?? "").toLowerCase();

  if (msg.includes("not mapped")) {
    return {
      status: 409,
      error: "Ваш магазин ще не підключено до складу розхідних матеріалів. Зверніться до адміністратора.",
      logStoreId: true,
    };
  }

  if (msg.includes("invalid feedbackgb cart item")) {
    return {
      status: 409,
      error: "Деякі позиції стали недоступні. Оновіть каталог і спробуйте ще раз.",
      logStoreId: false,
    };
  }

  return {
    status: 502,
    error: "Складський модуль не прийняв заявку",
    logStoreId: false,
  };
}
