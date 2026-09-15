import { createHmac } from "node:crypto";

const PIN_LOOKUP_HEX_RE = /^[a-f0-9]{64}$/;

/**
 * Stable, server-only lookup key for a PIN. The PIN itself and its bcrypt
 * hash remain the credential; this value exists solely to select one row
 * before doing the single bcrypt verification.
 */
export function pinLookup(pin: string): string {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error("PIN_PEPPER is not configured or is too short");
  }
  return createHmac("sha256", pepper).update(pin, "utf8").digest("hex");
}

export function isPinLookup(value: string): boolean {
  return PIN_LOOKUP_HEX_RE.test(value);
}
