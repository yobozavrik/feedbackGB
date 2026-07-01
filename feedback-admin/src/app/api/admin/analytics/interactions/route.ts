import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sess = await requireAdminSession("super_admin");
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  const pagePath = searchParams.get("page_path");
  const limitStr = searchParams.get("limit");

  const limit = limitStr ? Math.min(10000, Math.max(1, parseInt(limitStr, 10))) : 5000;

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  let query = supabase
    .from("user_interactions")
    .select(
      "id, page_path, element_tag, element_id, element_text, x_ratio, y_ratio, viewport_w, viewport_h, created_at, user_id, users(full_name, display_label)",
    );

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (pagePath) {
    query = query.eq("page_path", pagePath);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[analytics.interactions.get] error", { code: error.code });
    return NextResponse.json({ error: "failed to fetch interactions" }, { status: 500 });
  }

  return NextResponse.json({ interactions: data || [] });
}
