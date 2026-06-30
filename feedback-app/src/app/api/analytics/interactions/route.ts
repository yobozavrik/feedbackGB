import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  let userId: string | null = sess?.uid ?? null;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    page_path,
    element_tag,
    element_id,
    element_text,
    x_ratio,
    y_ratio,
    viewport_w,
    viewport_h,
  } = body;

  if (!page_path || typeof page_path !== "string") {
    return NextResponse.json({ error: "page_path is required" }, { status: 400 });
  }

  if (!userId && !page_path.startsWith("/login")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (
    typeof x_ratio !== "number" ||
    x_ratio < 0.0 ||
    x_ratio > 1.0 ||
    typeof y_ratio !== "number" ||
    y_ratio < 0.0 ||
    y_ratio > 1.0
  ) {
    return NextResponse.json({ error: "x_ratio and y_ratio must be between 0.0 and 1.0" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { error } = await supabase.from("user_interactions").insert({
    user_id: userId,
    page_path,
    element_tag: element_tag ? String(element_tag).slice(0, 50) : null,
    element_id: element_id ? String(element_id).slice(0, 100) : null,
    element_text: element_text ? String(element_text).slice(0, 100) : null,
    x_ratio,
    y_ratio,
    viewport_w: typeof viewport_w === "number" ? viewport_w : null,
    viewport_h: typeof viewport_h === "number" ? viewport_h : null,
  });

  if (error) {
    console.error("[analytics.interactions] insert error", { code: error.code });
    return NextResponse.json({ error: "failed to save interaction" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
