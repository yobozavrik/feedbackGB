import type { AdminUser } from "@/app/(admin)/admin/users/page";

// Client-side API wrappers for the /api/admin/users endpoints. Endpoints,
// methods, bodies and error extraction match what users-client.tsx did
// inline; UI concerns (messages, state updates) stay in the component.

export interface AdminAuditLogEntry {
  occurred_at: string;
  action_title: string;
  ip: string | null;
  user_agent: string | null;
  meta: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  isFeedback?: false;
}

export interface SellerFeedbackLogEntry {
  isFeedback: true;
  id: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  store_name: string | null;
  summary: string;
  status: string;
  occurred_at: string;
}

export type ActivityLogEntry = AdminAuditLogEntry | SellerFeedbackLogEntry;

export interface CreateUserValues {
  full_name: string;
  display_label: string;
  role: "seller" | "admin" | "super_admin";
  pin: string;
  store_id?: number;
}

export interface EditUserValues {
  full_name: string;
  display_label: string;
  role: "seller" | "admin" | "super_admin";
  store_id?: number;
  is_active: boolean;
}

export type ApiResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error?: string };

async function readError(res: Response): Promise<string | undefined> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error;
}

export async function unlockUser(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/admin/users/${id}/unlock`, { method: "POST" });
  return { ok: res.ok };
}

export async function setUserPin(
  id: string,
  pin: string,
): Promise<ApiResult<object>> {
  const res = await fetch(`/api/admin/users/${id}/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    return { ok: false, error: await readError(res) };
  }
  return { ok: true };
}

export async function createUser(
  values: CreateUserValues,
): Promise<ApiResult<{ user: AdminUser }>> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    return { ok: false, error: await readError(res) };
  }
  const data = (await res.json()) as { user: AdminUser };
  return { ok: true, user: data.user };
}

export async function patchUser(
  id: string,
  patch: Partial<EditUserValues>,
): Promise<ApiResult<{ user: AdminUser }>> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    return { ok: false, error: await readError(res) };
  }
  const data = (await res.json()) as { user: AdminUser };
  return { ok: true, user: data.user };
}

/** Latest audit-log entries where the user was the actor. Throws on HTTP error. */
export async function fetchAdminActivity(
  id: string,
): Promise<AdminAuditLogEntry[]> {
  const res = await fetch(`/api/admin/users/${id}/activity`);
  if (!res.ok) throw new Error("API error");
  const data = (await res.json()) as { logs?: AdminAuditLogEntry[] };
  return data.logs || [];
}
