// Seller-facing status vocabulary for consumables orders. Unlike the generic
// feedback statuses (feedbackStatusMeta.ts), these are DERIVED from the
// warehouse CRM order/transfer lifecycle (see consumablesOrder.ts):
//
//   order created, no transfer yet          → accepted  «Заявка прийнята»
//   transfer created ("Сформувати переміщення") → picking   «Збирається на складі»
//   transfer completed ("Підтвердити переміщення") → shipped  «Сформоване та відправлене»
//
// Client-safe: no server-only imports, so both API routes and components can
// use the labels/colours.

export type ConsumablesStatus = "accepted" | "picking" | "shipped";

export interface ConsumablesStatusMeta {
  label: string;
  /** Tailwind classes for the status chip. */
  chipClass: string;
  /** 0-based index into CONSUMABLES_TIMELINE for how far the order has progressed. */
  step: number;
}

export const CONSUMABLES_STATUS_META: Record<ConsumablesStatus, ConsumablesStatusMeta> = {
  accepted: { label: "Заявка прийнята", chipClass: "bg-[#d8e2ff] text-[#004493]", step: 0 },
  picking: { label: "Збирається на складі", chipClass: "bg-orange-100 text-orange-700", step: 1 },
  shipped: { label: "Сформоване та відправлене", chipClass: "bg-green-100 text-green-700", step: 2 },
};

export interface ConsumablesTimelineStep {
  label: string;
  description: string;
}

export const CONSUMABLES_TIMELINE: ConsumablesTimelineStep[] = [
  { label: "Прийнята", description: "Заявка передана на склад" },
  { label: "Збирається", description: "Комірник збирає позиції на складі" },
  { label: "Відправлена", description: "Сформовано переміщення та відправлено" },
];
