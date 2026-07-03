// Client-side API wrappers for the /api/admin/directions endpoints.
// Mirrors adminUsersApi.ts / adminFeedbackApi.ts: endpoints/methods/error
// extraction live here, UI concerns (messages, state) stay in components.

export interface AdminDirectionRow {
  id: string;
  admin_id: string;
  admin_full_name: string | null;
  category: string;
  category_title: string | null;
  store_id: number | null;
  store_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDirectionValues {
  admin_id: string;
  category: string;
  store_id: number | null;
}

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error?: string };

async function readError(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => "");
  let data: { error?: string; message?: string } = {};
  try {
    data = text ? (JSON.parse(text) as { error?: string; message?: string }) : {};
  } catch {
    data = {};
  }
  console.error("[adminDirectionsApi] request failed", {
    status: res.status,
    statusText: res.statusText,
    error: data.error,
  });
  // Prefer the human-readable `message` (e.g. the 409 scope-conflict
  // explanation) over the machine-readable `error` code.
  return data.message ?? data.error;
}

/** Returns null when the server answered non-OK (caller keeps previous state). */
export async function fetchDirections(): Promise<AdminDirectionRow[] | null> {
  const res = await fetch("/api/admin/directions");
  if (!res.ok) return null;
  const data = (await res.json()) as { directions?: AdminDirectionRow[] };
  return data.directions ?? [];
}

export async function createDirection(
  values: CreateDirectionValues,
): Promise<ApiResult<{ id: string }>> {
  const res = await fetch("/api/admin/directions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    return { ok: false, error: await readError(res) };
  }
  const data = (await res.json()) as { id: string };
  return { ok: true, id: data.id };
}

export async function setDirectionActive(
  id: string,
  isActive: boolean,
): Promise<ApiResult<object>> {
  const res = await fetch(`/api/admin/directions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) {
    return { ok: false, error: await readError(res) };
  }
  return { ok: true };
}
