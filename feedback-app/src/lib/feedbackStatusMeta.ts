// Seller-facing status labels/pill colors, shared by every "my requests"
// list (TransferRequests, HrDateRangeRequests, MyRequestsList). Must stay in
// sync with feedback-admin/src/lib/feedbackStatus.ts's FEEDBACK_STATUSES —
// that's the admin-facing (antd) equivalent, kept separate since the label
// wording and color scheme differ per audience.

export type FeedbackStatus = "new" | "in_progress" | "resolved" | "rejected";

// C4: each status gets its own color AND its own mark (dot/check/cross), so
// it still reads correctly without relying on color alone.
export type FeedbackStatusIcon = "dot" | "check" | "cross";

export interface FeedbackStatusMeta {
  label: string;
  className: string;
  icon: FeedbackStatusIcon;
}

export const STATUS_META: Record<FeedbackStatus, FeedbackStatusMeta> = {
  new: { label: "На розгляді", className: "bg-elev2 text-ink-700", icon: "dot" },
  in_progress: { label: "В роботі", className: "bg-brand-50 text-brand-600", icon: "dot" },
  resolved: { label: "Погоджено", className: "bg-success-soft text-success", icon: "check" },
  rejected: { label: "Не погоджено", className: "bg-danger-soft text-danger", icon: "cross" },
};
