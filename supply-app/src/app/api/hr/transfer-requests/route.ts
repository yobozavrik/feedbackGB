import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { listMyHrRequests } from "@/lib/hrList";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return listMyHrRequests(user.id, "transfer");
}
