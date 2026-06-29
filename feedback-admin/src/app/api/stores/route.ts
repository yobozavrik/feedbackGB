import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 60;

interface StoreRow {
  id: number;
  name: string;
  address: string | null;
}

const FALLBACK: StoreRow[] = [
  { id: 1, name: "Магазин №1", address: null },
  { id: 2, name: "Магазин №2", address: null },
  { id: 3, name: "Магазин №3", address: null },
  { id: 4, name: "Магазин №4", address: null },
  { id: 5, name: "Магазин №5", address: null },
];

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ stores: FALLBACK, source: "fallback" });
  }
  const { data, error } = await supabase
    .from("v_stores")
    .select("id, name, address")
    .eq("is_active", true)
    .order("id", { ascending: true });
  if (error || !data) {
    return NextResponse.json({
      stores: FALLBACK,
      source: "fallback",
      error: error?.message,
    });
  }
  return NextResponse.json({ stores: data as StoreRow[], source: "db" });
}
