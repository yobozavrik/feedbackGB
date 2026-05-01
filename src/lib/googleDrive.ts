import crypto from "node:crypto";

/**
 * Minimal Google Drive client using a service-account JSON key.
 *
 * The SA JSON is read from `GOOGLE_DRIVE_SA_KEY` (paste the full contents of
 * the .json file Google Cloud Console downloads). Authentication uses the
 * standard JWT bearer flow:
 *   1. Sign a short-lived JWT with the SA's private key (RS256).
 *   2. Exchange the JWT at https://oauth2.googleapis.com/token for an
 *      access_token (scope: drive.file — only files the SA itself creates).
 *   3. Use that token on Drive API v3.
 *
 * No external dependency required.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const TOKEN_DEFAULT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function getServiceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_DRIVE_SA_KEY;
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (
      typeof obj.client_email !== "string" ||
      typeof obj.private_key !== "string"
    ) {
      console.error("GOOGLE_DRIVE_SA_KEY missing client_email or private_key");
      return null;
    }
    return {
      client_email: obj.client_email,
      private_key: obj.private_key.replace(/\\n/g, "\n"),
      token_uri: obj.token_uri,
    };
  } catch (e) {
    console.error("GOOGLE_DRIVE_SA_KEY parse error", e);
    return null;
  }
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.value;
  }

  const tokenUri = sa.token_uri ?? TOKEN_DEFAULT;

  const header = b64url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(sa.private_key)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`google_token_exchange_failed_${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
  };
  return cachedToken.value;
}

export interface DriveUploadResult {
  id: string;
  name: string;
}

/**
 * Uploads a file into the given Drive folder via multipart upload. Returns
 * the Drive file id. The service account becomes the owner of the file.
 */
export async function uploadFileToDrive(opts: {
  sa: ServiceAccountKey;
  folderId: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
}): Promise<DriveUploadResult> {
  const token = await getAccessToken(opts.sa);

  const boundary = `---ftbg-${crypto.randomBytes(8).toString("hex")}`;
  const metadata = JSON.stringify({
    name: opts.name,
    parents: [opts.folderId],
    mimeType: opts.mimeType,
  });

  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${opts.mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;

  const headBytes = new TextEncoder().encode(head);
  const tailBytes = new TextEncoder().encode(tail);
  const body = new Uint8Array(headBytes.length + opts.data.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(opts.data, headBytes.length);
  body.set(tailBytes, headBytes.length + opts.data.length);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`drive_upload_failed_${res.status}: ${txt.slice(0, 300)}`);
  }
  return (await res.json()) as DriveUploadResult;
}

function b64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
