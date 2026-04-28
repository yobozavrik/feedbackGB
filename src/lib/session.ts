/**
 * Tiny stateless session token: base64url(JSON).base64url(hmac).
 * Stored in an httpOnly cookie. NOT a JWT — we just need a signed payload.
 *
 * Implemented with the WebCrypto API so the same code works in both the
 * Node.js runtime (API routes) and the Edge runtime (middleware).
 */

export interface SessionPayload {
  /** feedbackgb.users.id */
  uid: string;
  full_name: string;
  role: "seller" | "admin";
  /** categories.spots.spot_id (null for admins or non-store users) */
  store_id: number | null;
  /** issued at, ms */
  iat: number;
}

const COOKIE_NAME = "fbgb_session";
const ONE_DAY = 60 * 60 * 24;

function getSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-only-secret-change-me"
  );
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(p: SessionPayload): Promise<string> {
  const enc = new TextEncoder();
  const bodyBytes = enc.encode(JSON.stringify(p));
  const body = b64urlEncode(bodyBytes);
  const key = await getKey();
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body)),
  );
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const enc = new TextEncoder();
  const key = await getKey();
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body)),
  );
  const actual = b64urlDecode(sig);
  if (!timingSafeEq(expected, actual)) return null;
  try {
    const dec = new TextDecoder();
    const parsed = JSON.parse(dec.decode(b64urlDecode(body))) as SessionPayload;
    if (parsed.iat && Date.now() - parsed.iat > 30 * ONE_DAY * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = 30 * ONE_DAY; // 30 days
