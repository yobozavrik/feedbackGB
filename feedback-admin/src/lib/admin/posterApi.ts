const POSTER_API = "https://joinposter.com/api/";

export class PosterApiError extends Error {
  constructor(public code: string) { super(code); }
}

/** Server-only Poster request. Never include the URL or Poster body in errors: the URL contains the token. */
export async function posterRequest<T>(method: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(method, POSTER_API);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new PosterApiError("poster_unavailable");
  }
  if (!response.ok) throw new PosterApiError("poster_unavailable");
  let body: { response?: T; error?: unknown };
  try { body = await response.json(); } catch { throw new PosterApiError("poster_invalid_response"); }
  if (!body || typeof body !== "object" || body.error || !("response" in body)) throw new PosterApiError("poster_invalid_response");
  return body.response as T;
}
