import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete expired, unclaimed uploads after their 24-hour retry window. */
export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (process.env.UTILITY_READINGS_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: true });
  const db = getServerSupabase();
  if (!db) return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });
  const { data: expired, error } = await db.from("utility_uploads").select("id,storage_path")
    .is("claimed_by", null).lt("expires_at", new Date().toISOString()).order("expires_at").limit(100);
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  let cleaned = 0;
  for (const upload of expired ?? []) {
    const { error: storageError } = await db.storage.from("utility-reading-photos").remove([upload.storage_path]);
    if (storageError) continue;
    const { error: deleteError } = await db.from("utility_uploads").delete().eq("id", upload.id).is("claimed_by", null);
    if (!deleteError) cleaned += 1;
  }
  return NextResponse.json({ ok: true, cleaned, scanned: expired?.length ?? 0 });
}
