import { serveStoreCatalogView } from "@/lib/admin/storeCatalogRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return serveStoreCatalogView(request, "products");
}
