import type { Interaction } from "./interactionStats";

// Client-side wrapper for /api/admin/analytics/interactions. Endpoint,
// params and error behavior match what analytics-client.tsx did inline.

/** Throws on HTTP error; caller decides how to surface it. */
export async function fetchInteractions(
  userId: string | undefined,
  pagePath: string,
): Promise<Interaction[]> {
  const params = new URLSearchParams();
  if (userId) params.append("user_id", userId);
  params.append("page_path", pagePath);
  params.append("limit", "2000");

  const res = await fetch(`/api/admin/analytics/interactions?${params.toString()}`);
  if (!res.ok) throw new Error("API error");
  const data = (await res.json()) as { interactions?: Interaction[] };
  return data.interactions || [];
}
