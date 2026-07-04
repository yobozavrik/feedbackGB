import type { getServerSupabase } from "@/lib/supabase";

// supabase.ts stays per-app (it imports @supabase/supabase-js from the app's
// node_modules); the @/* alias resolves to the compiling app's own copy, so
// we derive the client type from it instead of importing supabase-js here.
type LooseClient = NonNullable<ReturnType<typeof getServerSupabase>>;

export type NotificationType =
  | "feedback.assigned_to_admin"
  | "feedback.status_in_progress_for_seller"
  | "feedback.status_resolved_for_seller";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  feedback_id: string | null;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

interface CreateNotificationArgs {
  recipientUserId: string;
  feedbackId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

/**
 * Inserts a notification row. Never throws — a notification failure must
 * never break the business action (feedback creation, status update) that
 * triggered it. Logs and returns silently on error.
 */
export async function createNotification(
  supabase: LooseClient,
  args: CreateNotificationArgs,
): Promise<void> {
  try {
    const { error } = await supabase.from("notifications").insert({
      recipient_user_id: args.recipientUserId,
      feedback_id: args.feedbackId ?? null,
      type: args.type,
      title: args.title,
      body: args.body,
      payload: args.payload ?? {},
    });
    if (error) {
      console.error("[notifications] insert failed", { code: error.code });
    }
  } catch (err) {
    console.error("[notifications] insert threw", err);
  }
}

interface ListNotificationsArgs {
  recipientUserId: string;
  unreadOnly?: boolean;
  limit?: number;
}

export async function listNotifications(
  supabase: LooseClient,
  args: ListNotificationsArgs,
): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
  const limit = Math.min(args.limit ?? 50, 100);

  let query = supabase
    .from("notifications")
    .select("id, type, title, body, feedback_id, payload, is_read, created_at")
    .eq("recipient_user_id", args.recipientUserId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (args.unreadOnly) query = query.eq("is_read", false);

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    query,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", args.recipientUserId)
      .eq("is_read", false),
  ]);

  if (error) {
    console.error("[notifications] list failed", { code: error.code });
    return { notifications: [], unreadCount: 0 };
  }
  if (countError) {
    console.error("[notifications] unread count failed", { code: countError.code });
  }

  return {
    notifications: (data ?? []) as NotificationRow[],
    unreadCount: count ?? 0,
  };
}

/** Idempotent: marking an already-read notification succeeds without error. */
export async function markNotificationRead(
  supabase: LooseClient,
  recipientUserId: string,
  notificationId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_user_id", recipientUserId)
    .eq("is_read", false);
  if (error) {
    console.error("[notifications] mark read failed", { code: error.code });
    return false;
  }
  return true;
}

export async function markAllNotificationsRead(
  supabase: LooseClient,
  recipientUserId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("recipient_user_id", recipientUserId)
    .eq("is_read", false);
  if (error) {
    console.error("[notifications] mark all read failed", { code: error.code });
    return false;
  }
  return true;
}
