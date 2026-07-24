// Supply-app shim. The seller feedback-app version writes failed submissions
// to IndexedDB and syncs later via OfflineSyncProvider. Supply-app doesn't
// carry that infrastructure yet — this shim exposes the same surface so the
// ported ConsumablesCartForm compiles, but every save throws. The seller code
// is already wrapped in try/catch around this call, so the user just sees a
// generic "не вдалось відправити" — no crash, no phantom queue.
//
// TODO: wire real IndexedDB + a supply OfflineSyncProvider when the flow is
// used in the field beyond the office wifi.

import type { FeedbackPayload } from "@/lib/types";

export interface OfflineSubmission {
  id: string;
  client_submission_id: string;
  submitter_uid: string;
  submitter_store_id: number | null;
  submitter_name: string;
  payload: FeedbackPayload;
  client_created_at: string;
  status: "pending" | "syncing" | "failed_auth" | "failed_validation";
  attempts: number;
  last_error?: string;
  last_attempt_at?: string;
}

export async function saveOfflineSubmission(_submission: OfflineSubmission): Promise<void> {
  throw new Error("Offline queue is not enabled in supply-app yet");
}
