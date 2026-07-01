// Client-side API wrappers for the /api/admin/feedback endpoints.
// Endpoints, methods, bodies and error extraction match what
// admin-client.tsx did inline; UI concerns stay in the components.

export interface FeedbackComment {
  id: string;
  feedback_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author_name: string;
  author_role: "seller" | "admin" | "super_admin";
}

export interface FeedbackPatch {
  status?: string;
  assigned_to?: string | null;
  comment?: string;
}

/** Returns null when the server answered non-OK (caller keeps previous state). */
export async function fetchFeedbackComments(
  feedbackId: string,
): Promise<FeedbackComment[] | null> {
  const res = await fetch(`/api/admin/feedback/${feedbackId}/comments`);
  if (!res.ok) return null;
  const data = (await res.json()) as { comments?: FeedbackComment[] };
  return data.comments ?? [];
}

export async function addFeedbackComment(
  feedbackId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error?: string }> {
  const res = await fetch(`/api/admin/feedback/${feedbackId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error };
  }
  return { ok: true };
}

export async function patchFeedback(
  id: string,
  patch: FeedbackPatch,
): Promise<{ ok: true } | { ok: false; error?: string; status: number }> {
  const res = await fetch(`/api/admin/feedback/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error, status: res.status };
  }
  return { ok: true };
}
