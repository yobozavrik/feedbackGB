// Seller-facing status labels/pill colors, shared by every "my requests"
// list (TransferRequests, HrDateRangeRequests, MyRequestsList). Must stay in
// sync with feedback-admin/src/lib/feedbackStatus.ts's FEEDBACK_STATUSES —
// that's the admin-facing (antd) equivalent, kept separate since the label
// wording and color scheme differ per audience.

export type FeedbackStatus = "new" | "in_progress" | "resolved" | "rejected";

export interface FeedbackStatusMeta {
  label: string;
  className: string;
}

export const STATUS_META: Record<FeedbackStatus, FeedbackStatusMeta> = {
  new: { label: "На розгляді", className: "bg-elev2 text-ink-700" },
  in_progress: { label: "В роботі", className: "bg-brand-50 text-brand-600" },
  resolved: { label: "Погоджено", className: "bg-success/15 text-success" },
  rejected: { label: "Не погоджено", className: "bg-danger/15 text-danger" },
};
