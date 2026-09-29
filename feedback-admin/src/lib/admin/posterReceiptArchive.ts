import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Backend-only archive primitive. Keys must come from external secret storage.
 * Archive the ORIGINAL response bytes, not JSON.stringify(response.json()).
 * Authentication binds ciphertext to its source/account/run/page or client snapshot.
 * No plaintext, token, request URL or source body may be included in errors/logs.
 */
export type ReceiptArchiveContext = {
  accountId: string;
  objectId: string;
  endpoint: "transactions.getTransactions" | "clients.getClient";
};
export type ReceiptArchiveEnvelope = {
  format: "aes-256-gcm-v1";
  keyId: string;
  nonce: string;
  tag: string;
  ciphertext: string;
};
const MAX_BYTES = 32 * 1024 * 1024;
function fail(): never { throw new Error("receipt_archive_invalid"); }
function aad(context: ReceiptArchiveContext, keyId: string): Buffer {
  for (const value of [context.accountId, context.objectId, keyId]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) fail();
  }
  if (!["transactions.getTransactions", "clients.getClient"].includes(context.endpoint)) fail();
  return Buffer.from(JSON.stringify(["poster-receipt-archive", 1, keyId,
    context.accountId, context.endpoint, context.objectId]), "utf8");
}
function decode(value: string, size?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (size !== undefined && bytes.length !== size)) fail();
  return bytes;
}
export function encryptReceiptArchive(raw: Uint8Array, context: ReceiptArchiveContext,
  key: Uint8Array, keyId: string): ReceiptArchiveEnvelope {
  if (key.length !== 32 || raw.length === 0 || raw.length > MAX_BYTES) fail();
  const auth = aad(context, keyId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(auth);
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return { format: "aes-256-gcm-v1", keyId, nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
export function decryptReceiptArchive(envelope: ReceiptArchiveEnvelope, context: ReceiptArchiveContext,
  key: Uint8Array): Buffer {
  try {
    if (envelope.format !== "aes-256-gcm-v1" || key.length !== 32 ||
      typeof envelope.ciphertext !== "string" || envelope.ciphertext.length > Math.ceil(MAX_BYTES / 3) * 4) fail();
    const ciphertext = decode(envelope.ciphertext);
    if (!ciphertext.length || ciphertext.length > MAX_BYTES) fail();
    const decipher = createDecipheriv("aes-256-gcm", key, decode(envelope.nonce, 12));
    decipher.setAAD(aad(context, envelope.keyId));
    decipher.setAuthTag(decode(envelope.tag, 16));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch { return fail(); }
}
