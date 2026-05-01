import { getServerSupabase } from "@/lib/supabase";
import {
  getServiceAccount,
  uploadFileToDrive,
  type DriveUploadResult,
} from "@/lib/googleDrive";

type Supabase = NonNullable<ReturnType<typeof getServerSupabase>>;

const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 5;

interface CandidateRow {
  id: string;
  created_at: string;
  photo_url: string;
  store_name: string | null;
}

interface MirrorRow {
  feedback_id: string;
  mirrored_at: string | null;
  attempts: number;
}

export type MirrorOutcome =
  | {
      ok: true;
      mirrored: number;
      failed: number;
      skipped: number;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

/**
 * Uploads every feedback photo that doesn't yet have a successful entry in
 * `photo_mirror` to Google Drive. Idempotent — safe to call repeatedly.
 *
 * Run by:
 *   - The cron at /api/cron/mirror-to-drive (CRON_SECRET-gated)
 *   - The daily report cron, right after the Telegram send (so each day's
 *     photos are backed up by 21:30 Kyiv).
 */
export async function mirrorPendingPhotos(): Promise<MirrorOutcome> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const sa = getServiceAccount();
  if (!folderId || !sa) {
    return { ok: false, error: "drive_env_missing", status: 503 };
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return { ok: false, error: "supabase_not_configured", status: 503 };
  }

  // Pull a candidate batch: rows that have a photo and aren't fully mirrored.
  const { data: feedbackRows, error: fbErr } = await supabase
    .from("feedback_feed")
    .select("id, created_at, photo_url, store_name")
    .not("photo_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(BATCH_LIMIT * 2);
  if (fbErr) {
    console.error("mirror-to-drive feedback fetch error", { code: fbErr.code });
    return { ok: false, error: "db_error", status: 500 };
  }
  const candidates = (feedbackRows ?? []) as CandidateRow[];
  if (candidates.length === 0) {
    return { ok: true, mirrored: 0, failed: 0, skipped: 0 };
  }

  const ids = candidates.map((r) => r.id);
  const { data: mirrorRows, error: mErr } = await supabase
    .from("photo_mirror")
    .select("feedback_id, mirrored_at, attempts")
    .in("feedback_id", ids);
  if (mErr) {
    console.error("mirror-to-drive mirror fetch error", { code: mErr.code });
    return { ok: false, error: "db_error", status: 500 };
  }
  const mirrorByFeedback = new Map<string, MirrorRow>();
  for (const m of (mirrorRows ?? []) as MirrorRow[]) {
    mirrorByFeedback.set(m.feedback_id, m);
  }

  const todo: CandidateRow[] = [];
  let skipped = 0;
  for (const r of candidates) {
    const m = mirrorByFeedback.get(r.id);
    if (!m) {
      todo.push(r);
    } else if (!m.mirrored_at && m.attempts < MAX_ATTEMPTS) {
      todo.push(r);
    } else {
      skipped++;
    }
    if (todo.length >= BATCH_LIMIT) break;
  }

  let mirrored = 0;
  let failed = 0;

  for (const row of todo) {
    const path = resolveStoragePath(row.photo_url);
    if (!path) {
      await journalFailure(supabase, row.id, "non_sb_photo_url");
      failed++;
      continue;
    }

    let bytes: Uint8Array;
    let mimeType: string;
    try {
      const dl = await supabase.storage.from("feedback-photos").download(path);
      if (dl.error || !dl.data) {
        throw new Error(dl.error?.message ?? "no_data");
      }
      bytes = new Uint8Array(await dl.data.arrayBuffer());
      mimeType = dl.data.type || "application/octet-stream";
    } catch (e) {
      console.error("mirror-to-drive download failed", { id: row.id, e });
      await journalFailure(
        supabase,
        row.id,
        `download_failed: ${(e as Error).message}`.slice(0, 300),
      );
      failed++;
      continue;
    }

    const name = buildDriveFileName(row, path);

    let result: DriveUploadResult;
    try {
      result = await uploadFileToDrive({
        sa,
        folderId,
        name,
        mimeType,
        data: bytes,
      });
    } catch (e) {
      console.error("mirror-to-drive upload failed", { id: row.id, e });
      await journalFailure(
        supabase,
        row.id,
        `upload_failed: ${(e as Error).message}`.slice(0, 300),
      );
      failed++;
      continue;
    }

    const { error: upErr } = await supabase.from("photo_mirror").upsert(
      {
        feedback_id: row.id,
        drive_file_id: result.id,
        mirrored_at: new Date().toISOString(),
        error: null,
        attempts: (mirrorByFeedback.get(row.id)?.attempts ?? 0) + 1,
        last_attempt: new Date().toISOString(),
      },
      { onConflict: "feedback_id" },
    );
    if (upErr) {
      console.error("mirror-to-drive journal upsert failed", {
        id: row.id,
        code: upErr.code,
      });
    }
    mirrored++;
  }

  return { ok: true, mirrored, failed, skipped };
}

async function journalFailure(
  supabase: Supabase,
  feedbackId: string,
  message: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("photo_mirror")
    .select("attempts")
    .eq("feedback_id", feedbackId)
    .maybeSingle();
  const prev = (existing as { attempts: number } | null)?.attempts ?? 0;
  await supabase.from("photo_mirror").upsert(
    {
      feedback_id: feedbackId,
      drive_file_id: null,
      mirrored_at: null,
      error: message,
      attempts: prev + 1,
      last_attempt: new Date().toISOString(),
    },
    { onConflict: "feedback_id" },
  );
}

function resolveStoragePath(raw: string): string | null {
  if (raw.startsWith("sb:")) return raw.slice(3);
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const prefix = `${projectUrl}/storage/v1/object/public/feedback-photos/`;
  if (projectUrl && raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return null;
}

function buildDriveFileName(row: CandidateRow, storagePath: string): string {
  const ext = (storagePath.match(/\.([a-z0-9]+)$/i)?.[1] ?? "jpg").toLowerCase();
  const date = row.created_at.slice(0, 10);
  const store = sanitize(row.store_name ?? "no-store");
  const idShort = row.id.slice(0, 8);
  return `${date}_${store}_${idShort}.${ext}`;
}

function sanitize(s: string): string {
  return (
    s
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "store"
  );
}
