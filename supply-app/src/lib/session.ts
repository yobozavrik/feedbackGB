export type SupplyRole = "supply_worker" | "admin" | "super_admin";

export interface SupplySession {
  uid: string;
  full_name: string;
  role: SupplyRole;
  facility_id: string | null;
  iat: number;
}

export const SUPPLY_SESSION_COOKIE = "supply_session";
export const SUPPLY_SESSION_MAX_AGE = 12 * 60 * 60;

export function getSessionSecret(): string {
  const secret = process.env.SUPPLY_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SUPPLY_SESSION_SECRET must contain at least 32 characters.");
  }
  return "supply-local-dev-secret-not-for-production";
}

function encode(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSupplySession(session: SupplySession): Promise<string> {
  const body = encode(new TextEncoder().encode(JSON.stringify(session)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(body)));
  return `${body}.${encode(signature)}`;
}

export async function verifySupplySession(token?: string): Promise<SupplySession | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      decode(signature) as BufferSource,
      new TextEncoder().encode(body),
    );
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(decode(body))) as SupplySession;
    const now = Date.now();
    if (
      !session.uid ||
      !session.iat ||
      session.iat > now + 60_000 ||
      now - session.iat > SUPPLY_SESSION_MAX_AGE * 1000
    ) return null;
    if (!["supply_worker", "admin", "super_admin"].includes(session.role)) return null;
    return session;
  } catch {
    return null;
  }
}
