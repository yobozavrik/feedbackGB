import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getWarehouseCrmSupabase } from "@/lib/warehouseCrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SUPPLY_WAREHOUSE_ID = 37;

export async function GET(req: Request) {
  if (!await verifySession(cookies().get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const url = new URL(req.url);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80) || null;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? 50)));
  const db = getWarehouseCrmSupabase();
  if (!db) return NextResponse.json({ error: "catalog_unavailable" }, { status: 503 });
  const { data, error } = await db.rpc("rpc_product_catalog", {
    p_category_id: null, p_search: search, p_warehouse_id: SUPPLY_WAREHOUSE_ID,
    p_page: page, p_page_size: pageSize,
  });
  if (error) {
    console.error("[consumables/catalog]", { code: error.code });
    return NextResponse.json({ error: "catalog_unavailable" }, { status: 503 });
  }
  const raw = data as { items?: Array<Record<string, unknown>>; total?: number; total_pages?: number };
  return NextResponse.json({
    items: (raw.items ?? []).map((item) => ({ id: item.id, name: item.name, sku: item.sku ?? null, unit: item.unit, photo_url: item.photo_url ?? null, category_id: item.category_id ?? null, category_name: item.category_name ?? null })),
    total: raw.total ?? 0, page, page_size: pageSize, total_pages: raw.total_pages ?? 1,
  });
}
