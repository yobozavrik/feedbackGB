"use client";

export type HrFields = Record<string, string | number | null>;

/**
 * POST an HR request to the supply feedback endpoint. The server owns identity
 * (facility, store_label), so the client only sends the topic fields.
 * Throws with a user-facing message on failure.
 */
export async function submitHrRequest(fields: HrFields, photoDataUrl?: string | null): Promise<void> {
  const body: Record<string, unknown> = {
    category: "hr_question",
    fields,
    client_submission_id: crypto.randomUUID(),
    client_created_at: new Date().toISOString(),
  };
  if (photoDataUrl) body.photo_url = photoDataUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new Error("Немає зв'язку. Спробуй ще раз.");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "Не вдалося відправити. Спробуй ще раз.");
  }
}
