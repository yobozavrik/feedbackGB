import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  isAdminTier,
  isSuperAdmin,
  verifySession,
  type SessionPayload,
} from "@/lib/session";

/**
 * Reads the session cookie and checks it meets the given tier. Lives
 * outside session.ts on purpose: session.ts is imported by the Edge
 * middleware too and must stay framework-free, while this helper needs
 * `next/headers` (Route Handler / Server Component only).
 *
 * "admin" (default) allows both admin and super_admin. "super_admin"
 * requires exactly that role. Returns null — never throws — so callers
 * turn a null into their own 403 response.
 */
export async function requireAdminSession(
  minTier: "admin" | "super_admin" = "admin",
): Promise<SessionPayload | null> {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) return null;
  const ok = minTier === "super_admin" ? isSuperAdmin(sess.role) : isAdminTier(sess.role);
  return ok ? sess : null;
}
