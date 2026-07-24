import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

/**
 * Shared body for the 5 self-service GET /api/hr/{topic}-requests endpoints.
 * Returns the caller's own hr_question rows for one topic, newest first.
 */
export async function listMyHrRequests(userId: string, topic: string) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ rows: [] });

  const { data, error } = await supabase
    .from("feedback")
    .select("id, created_at, status, fields")
    .eq("user_id", userId)
    .eq("category", "hr_question")
    .eq("fields->>hr_topic", topic)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[supply] hr list", { topic, code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
