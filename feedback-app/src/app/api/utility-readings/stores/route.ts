import { utilityContext } from "@/lib/utilityAccess";
import { utilityTrace } from "@/lib/utilityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stores are read from the live database; never use the generic fallback list. */
export async function GET(req: Request) {
  const trace = utilityTrace(req, "GET /api/utility-readings/stores");
  const context = await utilityContext();
  if ("error" in context) return trace.fail(context.error, context.status,
    context.status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
    context.status >= 500 ? "error" : "warn");
  const { db, actor } = context;
  const { data: stores, error: storesError } = await db.from("v_stores")
    .select("id,name,is_active").eq("is_active", true).order("name");
  if (storesError) return trace.fail("query_failed", 500, "utility.access.backend_failed", "error", { phase: "store_catalog" });
  if (actor.role !== "seller") return trace.json({ stores: stores ?? [] });
  const { data: permissions, error } = await db.from("seller_store_permissions")
    .select("store_id").eq("seller_id", actor.id).is("revoked_at", null);
  if (error) return trace.fail("query_failed", 500, "utility.access.backend_failed", "error", { phase: "permissions" });
  const allowed = new Set<number>([actor.homeStoreId, ...(permissions ?? []).map((p) => p.store_id)]
    .filter((id): id is number => typeof id === "number"));
  return trace.json({ stores: (stores ?? []).filter((store) => allowed.has(store.id)) });
}
