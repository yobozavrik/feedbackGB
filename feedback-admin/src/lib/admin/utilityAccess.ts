import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";

export async function adminUtilityContext(minTier: "admin" | "super_admin" = "admin") {
  const session = await requireAdminSession(minTier);
  if (!session) return { error: "forbidden" as const, status: 403 };
  const db = getServerSupabase();
  if (!db) return { error: "backend_unavailable" as const, status: 503 };
  const { data: user, error } = await db.from("users")
    .select("id,role,is_active").eq("id", session.uid).maybeSingle();
  if (error || !user || !user.is_active || !["admin", "super_admin"].includes(user.role)
    || (minTier === "super_admin" && user.role !== "super_admin")) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { db, actor: { id: user.id as string, role: user.role as "admin" | "super_admin" } };
}
