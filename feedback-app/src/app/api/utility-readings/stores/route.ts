import { NextResponse } from "next/server";
import { utilityContext } from "@/lib/utilityAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stores are read from the live database; never use the generic fallback list. */
export async function GET() {
  const context = await utilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const { db, actor } = context;
  const { data: stores, error: storesError } = await db.from("v_stores")
    .select("id,name,is_active").eq("is_active", true).order("name");
  if (storesError) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if (actor.role !== "seller") return NextResponse.json({ stores: stores ?? [] });
  const { data: permissions, error } = await db.from("seller_store_permissions")
    .select("store_id").eq("seller_id", actor.id).is("revoked_at", null);
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  const allowed = new Set<number>([actor.homeStoreId, ...(permissions ?? []).map((p) => p.store_id)]
    .filter((id): id is number => typeof id === "number"));
  return NextResponse.json({ stores: (stores ?? []).filter((store) => allowed.has(store.id)) });
}
