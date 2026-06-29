/**
 * Thin server-side wrapper around the PostHog REST API.
 *
 * Uses `POSTHOG_PERSONAL_API_KEY` (server-only, never expose to the client).
 * The hostname is derived from `NEXT_PUBLIC_POSTHOG_HOST` (defaults to the
 * EU cloud) and rewritten from the ingestion subdomain (`eu.i.posthog.com`)
 * to the API subdomain (`eu.posthog.com`) — the SDK posts events to the
 * former, REST/Insights live on the latter.
 *
 * Project ID is resolved once and cached per Node-process lifetime:
 *   1. `POSTHOG_PROJECT_ID` env var, if set, wins (zero round-trips).
 *   2. Otherwise we GET /api/projects/ and pick the first project the
 *      personal key can see. If multiple projects exist, set the env var
 *      to disambiguate.
 *
 * All public functions return discriminated results — never throw — so
 * route handlers can render a friendly message instead of a 500.
 */
// IMPORTANT: this module is server-side only. It reads
// POSTHOG_PERSONAL_API_KEY which must never reach the browser. All callers
// should be route handlers (`route.ts`) or React server components / async
// server-only utilities. Do not import from `"use client"` files.

const ENV_PERSONAL_KEY = "POSTHOG_PERSONAL_API_KEY";
const ENV_PROJECT_ID = "POSTHOG_PROJECT_ID";
const ENV_HOST = "NEXT_PUBLIC_POSTHOG_HOST";

const DEFAULT_INGESTION_HOST = "https://eu.i.posthog.com";

let projectIdCache: number | null = null;

function getApiBase(): string {
  const ingestion = process.env[ENV_HOST] ?? DEFAULT_INGESTION_HOST;
  // SDK ingestion host is `eu.i.posthog.com`; REST API lives on
  // `eu.posthog.com`. Same goes for `us.i.posthog.com` / `us.posthog.com`.
  // Fallback: leave host as-is for self-hosted PostHog instances.
  return ingestion.replace(/\/+$/, "").replace(/\.i\.posthog\.com$/, ".posthog.com");
}

export class PosthogConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosthogConfigError";
  }
}

export class PosthogApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "PosthogApiError";
  }
}

function getPersonalKey(): string {
  const key = process.env[ENV_PERSONAL_KEY];
  if (!key) {
    throw new PosthogConfigError(
      `${ENV_PERSONAL_KEY} is not set — PostHog server-side queries are disabled.`,
    );
  }
  return key;
}

export interface PosthogProject {
  id: number;
  name: string;
}

export async function listProjects(): Promise<PosthogProject[]> {
  const base = getApiBase();
  const key = getPersonalKey();
  const res = await fetch(`${base}/api/projects/`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new PosthogApiError(
      `Failed to list PostHog projects`,
      res.status,
      await res.text(),
    );
  }
  const json = (await res.json()) as { results: PosthogProject[] };
  return json.results ?? [];
}

export async function getProjectId(): Promise<number> {
  if (projectIdCache !== null) return projectIdCache;
  const explicit = process.env[ENV_PROJECT_ID];
  if (explicit) {
    const parsed = Number(explicit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new PosthogConfigError(
        `${ENV_PROJECT_ID} is set but is not a positive integer: ${explicit}`,
      );
    }
    projectIdCache = parsed;
    return parsed;
  }
  const projects = await listProjects();
  if (projects.length === 0) {
    throw new PosthogConfigError(
      "Personal API key has no PostHog projects associated with it.",
    );
  }
  if (projects.length > 1) {
    // Don't silently pick — log a hint so the user sets the env var.
    console.warn(
      `[posthog] ${projects.length} projects visible to personal key; ` +
        `using "${projects[0].name}" (id=${projects[0].id}). ` +
        `Set ${ENV_PROJECT_ID} to override.`,
    );
  }
  projectIdCache = projects[0].id;
  return projectIdCache;
}

/**
 * Run a HogQL or InsightQuery against the project's `query` endpoint.
 * Returns the raw response body — caller is responsible for parsing.
 *
 * Docs: https://posthog.com/docs/api/queries
 */
export async function runQuery<T = unknown>(query: object): Promise<T> {
  const base = getApiBase();
  const key = getPersonalKey();
  const projectId = await getProjectId();
  const res = await fetch(`${base}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new PosthogApiError(
      `PostHog /query call failed`,
      res.status,
      await res.text(),
    );
  }
  return (await res.json()) as T;
}

/** Strip a thrown PostHog error down to a short user-facing string. */
export function formatPosthogError(err: unknown): string {
  if (err instanceof PosthogConfigError) return `PostHog не налаштовано: ${err.message}`;
  if (err instanceof PosthogApiError) {
    return `PostHog API ${err.status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return "Невідома помилка";
}
