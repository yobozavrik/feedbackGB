import { checkCronAuth } from "@/lib/cronAuth";
import { getServerSupabase } from "@/lib/supabase";
import { utilityTrace } from "@/lib/admin/utilityLog";
import { utilityReadingsEnabled } from "@/lib/admin/utilityFeature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete expired, unclaimed uploads after their 24-hour retry window. */
export async function GET(req: Request) {
  const trace = utilityTrace(req, "GET /api/cron/utility-cleanup");
  const auth = checkCronAuth(req);
  if (!auth.ok) return trace.fail(auth.error, auth.status, "utility.access.denied", "warn");
  // Photo cleanup must run when the app/admin feature is on, even while
  // Telegram dispatch remains disabled pending its separate chat setup.
  if (!utilityReadingsEnabled()) {
    return trace.json({ ok: true, skipped: true });
  }
  const db = getServerSupabase();
  if (!db) return trace.fail("backend_unavailable", 503, "utility.access.backend_failed", "error");
  const { data: expired, error } = await db.from("utility_uploads").select("id,storage_path")
    .is("claimed_by", null).lt("expires_at", new Date().toISOString()).order("expires_at").limit(100);
  if (error) return trace.fail("query_failed", 500, "utility.cleanup.query_failed", "error");
  let cleaned = 0;
  let failed = 0;
  for (const upload of expired ?? []) {
    const { error: storageError } = await db.storage.from("utility-reading-photos").remove([upload.storage_path]);
    if (storageError) {
      failed += 1;
      trace.log("utility.cleanup.storage_failed", "warn", { upload_id: upload.id, error_code: "storage_failed" });
      continue;
    }
    const { error: deleteError } = await db.from("utility_uploads").delete().eq("id", upload.id).is("claimed_by", null);
    if (deleteError) {
      failed += 1;
      trace.log("utility.cleanup.row_failed", "error", { upload_id: upload.id, error_code: "row_delete_failed" });
    } else cleaned += 1;
  }
  return trace.json({ ok: failed === 0, cleaned, failed, scanned: expired?.length ?? 0 });
}
