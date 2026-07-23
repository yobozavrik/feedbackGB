import { PinPad } from "@/components/PinPad";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SUPPLY_SESSION_COOKIE, verifySupplySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";
import { isSupplySchemaReady } from "@/lib/supplySchema";

export default async function HomePage() {
  const supabase = getServerSupabase();
  const schemaReady = supabase ? await isSupplySchemaReady(supabase) : false;
  const session = await verifySupplySession(cookies().get(SUPPLY_SESSION_COOKIE)?.value);
  if (session && schemaReady) redirect("/home");
  if (session) redirect("/api/auth/logout?next=%2F%3Fmodule%3Dnot-ready");
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
      <PinPad disabled={!schemaReady} />
    </div>
  );
}
