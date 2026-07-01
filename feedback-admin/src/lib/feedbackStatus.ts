// Single source of truth for feedback lifecycle statuses. Must stay in
// sync with the DB CHECK constraint (see supabase/schema.sql: `check
// (status in ('new', 'in_progress', 'resolved', 'rejected'))`).
//
// Entity-layer: pure data, no I/O, no framework imports.

export const FEEDBACK_STATUSES = [
  "new",
  "in_progress",
  "resolved",
  "rejected",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export interface FeedbackStatusMeta {
  text: string;
  color: string;
}

export const FEEDBACK_STATUS_META: Record<FeedbackStatus, FeedbackStatusMeta> = {
  new: { text: "Нове", color: "green" },
  in_progress: { text: "В роботі", color: "gold" },
  resolved: { text: "Закрито", color: "default" },
  rejected: { text: "Відхилено", color: "purple" },
};
