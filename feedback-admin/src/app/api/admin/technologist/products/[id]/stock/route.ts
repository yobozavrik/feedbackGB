import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getLiveProductStock, PosterStockError } from "@/lib/admin/posterStock";
import { PosterApiError } from "@/lib/admin/posterApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!await requireAdminSession("super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!/^\d+$/.test(params.id) || !Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400 });
  }
  const token = process.env.POSTER_TOKEN;
  if (!token) return NextResponse.json({ error: "Poster не налаштовано" }, { status: 503 });
  try {
    const stock = await getLiveProductStock(id, token);
    return NextResponse.json(stock, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const code = error instanceof PosterApiError || error instanceof PosterStockError ? error.code : "poster_unavailable";
    const status = code === "product_missing_in_poster" ? 404 : 503;
    return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
