import { CheckIcon, XIcon } from "@/components/icons";
import { STATUS_META, type FeedbackStatus } from "@/lib/feedbackStatusMeta";

/**
 * C4: the one place that renders a feedback status — used by MyRequestsList,
 * HrDateRangeRequests, TransferRequests, and RequestDetail so every list
 * shows the same colors and marks instead of each building its own `<span
 * className={pill ...}>`.
 */
export function StatusPill({
  status,
  className = "",
}: {
  status: FeedbackStatus;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.new;
  return (
    <span className={`pill ${meta.className} ${className}`}>
      {meta.icon === "check" ? (
        <CheckIcon size={12} />
      ) : meta.icon === "cross" ? (
        <XIcon size={12} />
      ) : (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {meta.label}
    </span>
  );
}
