import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export interface CronEntry {
  path: string;
  schedule: string;
}

export interface IntegrationStatus {
  key: string;
  label: string;
  description: string;
  set: boolean;
}

export interface SettingsData {
  profile: {
    uid: string;
    full_name: string;
    role: "seller" | "admin";
    store_id: number | null;
    store_name: string | null;
    has_pin: boolean;
    last_login: string | null;
  };
  crons: CronEntry[];
  lastManualReport: { occurred_at: string; meta: unknown } | null;
  lastManualMirror: { occurred_at: string; meta: unknown } | null;
  integrations: IntegrationStatus[];
}

async function readCronConfig(): Promise<CronEntry[]> {
  try {
    const file = path.join(process.cwd(), "vercel.json");
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    return (parsed.crons ?? [])
      .filter((c): c is CronEntry => !!c.path && !!c.schedule)
      .map((c) => ({ path: c.path, schedule: c.schedule }));
  } catch {
    return [];
  }
}

function detectIntegrations(): IntegrationStatus[] {
  return [
    {
      key: "supabase",
      label: "Supabase",
      description: "База даних, фідбек, Storage для фото",
      set:
        Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        Boolean(
          process.env.SUPABASE_SERVICE_ROLE_KEY ??
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        ),
    },
    {
      key: "telegram_bot",
      label: "Telegram Bot",
      description: "Токен бота для відправки звітів",
      set: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    },
    {
      key: "telegram_chat",
      label: "Telegram Chat ID",
      description: "Куди надсилається щоденний звіт",
      set: Boolean(process.env.TELEGRAM_REPORT_CHAT_ID),
    },
    {
      key: "drive_folder",
      label: "Google Drive (папка)",
      description: "ID папки, куди дзеркаляться фото",
      set: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID),
    },
    {
      key: "drive_sa",
      label: "Google Drive (Service Account)",
      description: "Ключ сервіс-акаунту для запису у папку",
      set: Boolean(process.env.GOOGLE_DRIVE_SA_KEY),
    },
    {
      key: "cron_secret",
      label: "CRON_SECRET",
      description: "Захист cron-ендпоінтів від несанкціонованого виклику",
      set: Boolean(process.env.CRON_SECRET),
    },
    {
      key: "session_secret",
      label: "SESSION_SECRET",
      description: "Підпис сесійних cookie (не показується)",
      set:
        Boolean(process.env.SESSION_SECRET) &&
        (process.env.SESSION_SECRET ?? "").length >= 16,
    },
  ];
}

async function fetchData(): Promise<SettingsData> {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || sess.role !== "admin") {
    redirect("/login?next=/admin/settings");
  }

  const supabase = getServerSupabase();
  const integrations = detectIntegrations();
  const crons = await readCronConfig();

  let userRow: {
    pin_hash: string | null;
    last_login: string | null;
  } | null = null;
  let storeName: string | null = null;
  let lastManualReport: { occurred_at: string; meta: unknown } | null = null;
  let lastManualMirror: { occurred_at: string; meta: unknown } | null = null;

  if (supabase) {
    const [
      { data: u },
      { data: storeRow },
      { data: reportRow },
      { data: mirrorRow },
    ] = await Promise.all([
      supabase
        .from("users")
        .select("pin_hash, last_login")
        .eq("id", sess.uid)
        .maybeSingle(),
      sess.store_id != null
        ? supabase
            .from("v_stores")
            .select("name")
            .eq("id", sess.store_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("audit_log")
        .select("occurred_at, meta")
        .eq("action", "admin.send_report")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("audit_log")
        .select("occurred_at, meta")
        .eq("action", "admin.mirror_to_drive")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    userRow = (u as { pin_hash: string | null; last_login: string | null }) ?? null;
    storeName = (storeRow as { name?: string } | null)?.name ?? null;
    lastManualReport = (reportRow as {
      occurred_at: string;
      meta: unknown;
    } | null) ?? null;
    lastManualMirror = (mirrorRow as {
      occurred_at: string;
      meta: unknown;
    } | null) ?? null;
  }

  return {
    profile: {
      uid: sess.uid,
      full_name: sess.full_name,
      role: sess.role,
      store_id: sess.store_id,
      store_name: storeName,
      has_pin: userRow?.pin_hash != null,
      last_login: userRow?.last_login ?? null,
    },
    crons,
    lastManualReport,
    lastManualMirror,
    integrations,
  };
}

export default async function AdminSettingsPage() {
  const data = await fetchData();
  return (
    <AdminPageContainer
      title="Налаштування"
      subTitle="Профіль, розклади та статус інтеграцій. Жодних секретів не показується."
    >
      <SettingsClient data={data} />
    </AdminPageContainer>
  );
}
