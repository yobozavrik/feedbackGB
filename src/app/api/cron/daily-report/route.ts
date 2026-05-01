import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KYIV_TZ = "Europe/Kyiv";
const REPORT_HOUR_KYIV = 21; // 21:30 Kyiv: send only when local hour == 21

interface FeedRow {
  id: string;
  created_at: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  store_id: number | null;
  store_name: string | null;
  user_full_name: string | null;
  product_name: string | null;
  product_unit: string | null;
  quantity: number | string | null;
  fields: Record<string, unknown> | null;
  summary: string;
}

/**
 * GET /api/cron/daily-report
 * Vercel Cron entrypoint. Sends a Telegram report of every feedback that
 * was created today (Kyiv time) into TELEGRAM_REPORT_CHAT_ID.
 *
 * Scheduled twice (18:30 and 19:30 UTC) so summer (EEST=UTC+3) and
 * winter (EET=UTC+2) both hit Kyiv 21:30. The handler de-dupes by
 * checking that the current Kyiv hour is 21; the off-DST run exits early.
 */
export async function GET(req: Request) {
  // Vercel Cron sends Authorization: Bearer ${CRON_SECRET}.
  // Accept either CRON_SECRET (Vercel's recommended convention) or a manual
  // bypass for local debugging — but ONLY when not in production.
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (cronSecret) {
    if (!authHeader.startsWith("Bearer ") || authHeader.slice(7) !== cronSecret) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production" && !isVercelCron) {
    // Don't accept unauthenticated calls in prod even if CRON_SECRET is unset.
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }

  // Only run when local Kyiv hour is 21 (covers DST without dual triggering).
  const kyivNow = getKyivClock();
  if (kyivNow.hour !== REPORT_HOUR_KYIV) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `kyiv_hour=${kyivNow.hour}, expected=${REPORT_HOUR_KYIV}`,
    });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_REPORT_CHAT_ID;
  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "telegram_env_missing" },
      { status: 503 },
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  // Fetch the last 30 hours of feedback rows; filter to "Kyiv today" in JS.
  const cutoffIso = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("feedback_feed")
    .select(
      "id, created_at, category, category_emoji, category_title, store_id, store_name, user_full_name, product_name, product_unit, quantity, fields, summary",
    )
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("daily-report db error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const todayKyiv = kyivDateString(new Date());
  const rows = ((data ?? []) as FeedRow[]).filter(
    (r) => kyivDateString(new Date(r.created_at)) === todayKyiv,
  );

  const text = formatReport(rows, todayKyiv);
  await sendTelegram(botToken, chatId, text);

  return NextResponse.json({
    ok: true,
    sent: true,
    total: rows.length,
    kyiv_date: todayKyiv,
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getKyivClock(): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: KYIV_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

function kyivDateString(d: Date): string {
  // Returns "YYYY-MM-DD" of the given instant in Europe/Kyiv timezone.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatHumanDateUk(isoDate: string): string {
  // "YYYY-MM-DD" -> "DD.MM.YYYY"
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function formatReport(rows: FeedRow[], todayKyiv: string): string {
  const dateLabel = formatHumanDateUk(todayKyiv);

  if (rows.length === 0) {
    return `🌸 Звіт за ${dateLabel} (Київ)\n\nСьогодні без фідбеків.`;
  }

  // Group by category id.
  const groups = new Map<string, FeedRow[]>();
  for (const r of rows) {
    const list = groups.get(r.category) ?? [];
    list.push(r);
    groups.set(r.category, list);
  }

  // Stable display order: priority categories first, then everything else.
  const PRIORITY = ["missing_item", "overstock", "defect"];
  const orderedKeys = [
    ...PRIORITY.filter((c) => groups.has(c)),
    ...Array.from(groups.keys()).filter((c) => !PRIORITY.includes(c)),
  ];

  const stores = new Set(rows.map((r) => r.store_name).filter(Boolean));
  const lines: string[] = [];
  lines.push(`📊 Звіт за ${dateLabel} (Київ)`);
  lines.push("");
  lines.push(
    `Усього: ${rows.length} ${plural(rows.length, "фідбек", "фідбеки", "фідбеків")} · ${stores.size} ${plural(stores.size, "магазин", "магазини", "магазинів")}`,
  );
  lines.push("");

  for (const key of orderedKeys) {
    const groupRows = groups.get(key)!;
    const head = groupRows[0];
    const emoji = head.category_emoji ?? "📝";
    const title = head.category_title ?? key;
    lines.push(`${emoji} ${title} (${groupRows.length}):`);
    for (const r of groupRows) {
      lines.push(`• ${formatRowLine(r)}`);
    }
    lines.push("");
  }

  // Trim trailing blank line.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}

function formatRowLine(r: FeedRow): string {
  const store = r.store_name ?? "магазин не вказано";
  const author = r.user_full_name ?? "анонім";

  if (r.product_name) {
    const qty =
      r.quantity != null
        ? ` · ${r.quantity}${r.product_unit ? ` ${r.product_unit}` : ""}`
        : "";
    return `${store} — ${r.product_name}${qty} (${author})`;
  }

  // Legacy / non-priority categories: try item_name, otherwise summary fallback.
  const itemName =
    typeof r.fields?.["item_name"] === "string"
      ? (r.fields["item_name"] as string)
      : null;
  if (itemName) {
    return `${store} — ${itemName} (${author})`;
  }

  // Last resort: trim summary to first 120 chars.
  const trimmed =
    r.summary.length > 120 ? `${r.summary.slice(0, 117)}...` : r.summary;
  return `${store} (${author}): ${trimmed}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  // Ukrainian plural rules
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  // Telegram caps a single sendMessage at 4096 chars; chunk if needed.
  const MAX = 4000; // small headroom
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX) {
    chunks.push(text.slice(i, i + MAX));
  }

  for (const chunk of chunks) {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("telegram sendMessage failed", {
        status: res.status,
        body: body.slice(0, 300),
      });
      throw new Error(`telegram_send_failed_${res.status}`);
    }
  }
}
