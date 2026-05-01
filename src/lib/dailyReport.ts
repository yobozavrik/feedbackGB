import { getServerSupabase } from "@/lib/supabase";

type Supabase = NonNullable<ReturnType<typeof getServerSupabase>>;

export const KYIV_TZ = "Europe/Kyiv";
export const REPORT_HOUR_KYIV = 21;

// Photos in the report are pulled from a private Supabase Storage bucket via
// short-lived signed URLs. The bot's own sendPhoto fetch needs ~minutes; an
// hour is plenty for that. Click-through links surfaced in the report use
// SIGNED_URL_TTL_FOR_REPORT (longer-lived, see PhotoLinkBuilder).
const PHOTO_SIGNED_URL_TTL_SEC = 60 * 60;
// TTL for click-through links shown in the report itself. Capped to ~7 days
// because Supabase rejects longer durations and because the report is
// scrollable in the chat for that long anyway.
const PHOTO_REPORT_LINK_TTL_SEC = 7 * 24 * 60 * 60;
// Telegram caption ceiling is 1024 chars; leave headroom.
const TELEGRAM_CAPTION_MAX = 1000;
// Скільки днів історії підтягуємо для дельти, повторів і топ-авторів.
const HISTORY_DAYS = 7;
// "Застряглі" = новий запис, який висить у status='new' довше N днів.
const STUCK_DAYS_THRESHOLD = 3;
// Скільки магазинів показуємо в heatmap-табличці.
const HEATMAP_MAX_STORES = 6;
// Скільки топ-авторів показуємо.
const TOP_AUTHORS_LIMIT = 3;

interface FeedRow {
  id: string;
  created_at: string;
  category: string;
  category_emoji: string | null;
  category_title: string | null;
  store_id: number | null;
  store_name: string | null;
  user_id: string | null;
  user_full_name: string | null;
  product_id: number | null;
  product_name: string | null;
  product_unit: string | null;
  quantity: number | string | null;
  fields: Record<string, unknown> | null;
  photo_url: string | null;
  status: string | null;
  summary: string;
}

export type ReportResult =
  | {
      ok: true;
      sent: true;
      total: number;
      kyiv_date: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

/**
 * Builds today's (Kyiv) feedback summary and pushes it to the configured
 * Telegram group. Shared between the cron handler and the manual
 * "Send report now" admin endpoint.
 *
 * Звіт побудовано як "heatmap + сигнали": тепер тягнемо ще й 7-денний контекст,
 * щоб порахувати дельту, повтори браку, дублі по магазинах та топ-авторів.
 *
 * Фото в звіті клікабельні — посилання будує PhotoLinkBuilder, який
 * обирається за env REPORT_PHOTO_LINK_MODE (supabase|drive|telegram). Для
 * supergroup-mode фото відправляються ПЕРШИМИ, щоб спіймати message_id
 * і побудувати t.me deep-links; для решти послідовність звичайна.
 */
export async function buildAndSendDailyReport(): Promise<ReportResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_REPORT_CHAT_ID;
  if (!botToken || !chatId) {
    return { ok: false, error: "telegram_env_missing", status: 503 };
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return { ok: false, error: "supabase_not_configured", status: 503 };
  }

  // Тягнемо HISTORY_DAYS+1 днів — потрібно для дельти і застряглих, які
  // могли з'явитися раніше за minus-7-day cutoff.
  const cutoffMs = Date.now() - (HISTORY_DAYS + 1) * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const { data, error } = await supabase
    .from("feedback_feed")
    .select(
      "id, created_at, category, category_emoji, category_title, store_id, store_name, user_id, user_full_name, product_id, product_name, product_unit, quantity, fields, photo_url, status, summary",
    )
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("daily-report db error", { code: error.code });
    return { ok: false, error: "db_error", status: 500 };
  }

  const todayKyiv = kyivDateString(new Date());
  const allRows = (data ?? []) as FeedRow[];
  const todayRows = allRows.filter(
    (r) => kyivDateString(new Date(r.created_at)) === todayKyiv,
  );

  const builder = pickPhotoLinkBuilder();

  try {
    if (builder.requiresPhotosFirst) {
      // t.me deep-link mode: спочатку фото (збираємо message_ids), потім текст.
      const photoMessageIds = await sendPhotosForRows(
        supabase,
        botToken,
        chatId,
        todayRows,
        { collectMessageIds: true },
      );
      const photoLinks = await builder.build({
        supabase,
        botToken,
        chatId,
        todayRows,
        photoMessageIds,
      });
      const text = formatReport({
        todayRows,
        historyRows: allRows,
        todayKyiv,
        photoLinks,
      });
      await sendTelegramHtml(botToken, chatId, text);
    } else {
      // Supabase / Drive mode: будуємо посилання без фото, потім текст, потім фото.
      const photoLinks = await builder.build({
        supabase,
        botToken,
        chatId,
        todayRows,
      });
      const text = formatReport({
        todayRows,
        historyRows: allRows,
        todayKyiv,
        photoLinks,
      });
      await sendTelegramHtml(botToken, chatId, text);
      await sendPhotosForRows(supabase, botToken, chatId, todayRows);
    }
  } catch (e) {
    console.error("daily-report telegram error", e);
    return { ok: false, error: "telegram_send_failed", status: 502 };
  }

  return { ok: true, sent: true, total: todayRows.length, kyiv_date: todayKyiv };
}

// =============================================================================
//                       PHOTO LINK BUILDERS (варіанти A/B/C)
// =============================================================================

/** Map feedback_id → click-through URL для 📷 в звіті. */
export type PhotoLinkMap = Map<string, string>;

interface PhotoLinkBuilderContext {
  supabase: Supabase;
  botToken: string;
  chatId: string;
  todayRows: FeedRow[];
  /** Заповнюється лише для builder.requiresPhotosFirst=true (Telegram mode). */
  photoMessageIds?: Map<string, number>;
}

interface PhotoLinkBuilder {
  /** Якщо true — фото відправляються ДО тексту, щоб зібрати message_ids. */
  readonly requiresPhotosFirst: boolean;
  build(ctx: PhotoLinkBuilderContext): Promise<PhotoLinkMap>;
}

/**
 * Active mode (default): generate Supabase signed URLs with up-to-7d TTL.
 * Pros: works in any group, no extra infra. Cons: links expire after a week.
 */
class SupabaseSignedUrlBuilder implements PhotoLinkBuilder {
  readonly requiresPhotosFirst = false;
  async build(ctx: PhotoLinkBuilderContext): Promise<PhotoLinkMap> {
    const out: PhotoLinkMap = new Map();
    for (const r of ctx.todayRows) {
      if (!r.photo_url) continue;
      if (r.photo_url.startsWith("sb:")) {
        const path = r.photo_url.slice(3);
        const { data } = await ctx.supabase.storage
          .from("feedback-photos")
          .createSignedUrl(path, PHOTO_REPORT_LINK_TTL_SEC);
        if (data?.signedUrl) out.set(r.id, data.signedUrl);
        continue;
      }
      // Legacy public URL — повертаємо як є.
      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      if (
        projectUrl &&
        r.photo_url.startsWith(
          `${projectUrl}/storage/v1/object/public/feedback-photos/`,
        )
      ) {
        out.set(r.id, r.photo_url);
      }
    }
    return out;
  }
}

/**
 * Drive mode: використовує photo_mirror.drive_file_id (попередньо заповнюється
 * mirrorPendingPhotos). Вимагає, щоб папка GOOGLE_DRIVE_FOLDER_ID була
 * розшарена на всіх, хто клікатиме лінк.
 */
class DriveLinkBuilder implements PhotoLinkBuilder {
  readonly requiresPhotosFirst = false;
  async build(ctx: PhotoLinkBuilderContext): Promise<PhotoLinkMap> {
    const out: PhotoLinkMap = new Map();
    const ids = ctx.todayRows.filter((r) => r.photo_url).map((r) => r.id);
    if (ids.length === 0) return out;

    // Синхронно джеркаємо фото на Drive, щоб drive_file_id був гарантовано
    // заповнений до моменту розсилки. Швоввий import — щоб не додавати
    // top-level залежності на driveMirror, якщо режим неактивний.
    try {
      const { mirrorPendingPhotos } = await import("@/lib/driveMirror");
      await mirrorPendingPhotos();
    } catch (e) {
      console.warn("drive mirror pre-step failed", e);
    }

    const { data } = await ctx.supabase
      .from("photo_mirror")
      .select("feedback_id, drive_file_id")
      .in("feedback_id", ids)
      .not("drive_file_id", "is", null);
    for (const m of (data ?? []) as Array<{
      feedback_id: string;
      drive_file_id: string;
    }>) {
      out.set(
        m.feedback_id,
        `https://drive.google.com/file/d/${m.drive_file_id}/view`,
      );
    }
    return out;
  }
}

/**
 * Telegram supergroup deep-link mode: лінк `t.me/c/<chat>/<msg>` веде на
 * фото-повідомлення в тому ж чаті (не виходячи з Telegram). Працює ТІЛЬКИ для
 * supergroups (chat_id починається з -100). Для базових груп повертає порожню
 * мапу (формат t.me/c там не працює).
 */
class TelegramDeepLinkBuilder implements PhotoLinkBuilder {
  readonly requiresPhotosFirst = true;
  async build(ctx: PhotoLinkBuilderContext): Promise<PhotoLinkMap> {
    const out: PhotoLinkMap = new Map();
    if (!ctx.photoMessageIds) return out;
    const chatStr = String(ctx.chatId);
    if (!chatStr.startsWith("-100")) {
      console.warn(
        "telegram deep-link mode requires supergroup (chat_id starts with -100); falling back to plain emoji",
      );
      return out;
    }
    const internalId = chatStr.slice(4);
    for (const [feedbackId, msgId] of ctx.photoMessageIds) {
      out.set(feedbackId, `https://t.me/c/${internalId}/${msgId}`);
    }
    return out;
  }
}

function pickPhotoLinkBuilder(): PhotoLinkBuilder {
  const mode = (process.env.REPORT_PHOTO_LINK_MODE ?? "supabase").toLowerCase();
  switch (mode) {
    case "drive":
      return new DriveLinkBuilder();
    case "telegram":
      return new TelegramDeepLinkBuilder();
    case "supabase":
    default:
      return new SupabaseSignedUrlBuilder();
  }
}

interface SendPhotosOptions {
  /** Якщо true — повертає Map<feedback_id, message_id> для t.me deep-links. */
  collectMessageIds?: boolean;
}

async function sendPhotosForRows(
  supabase: Supabase,
  botToken: string,
  chatId: string,
  rows: FeedRow[],
  options: SendPhotosOptions = {},
): Promise<Map<string, number>> {
  const messageIds = new Map<string, number>();
  for (const r of rows) {
    if (!r.photo_url) continue;
    const url = await resolvePhotoUrl(supabase, r.photo_url);
    if (!url) continue;
    let caption = formatPhotoCaption(r);
    if (caption.length > TELEGRAM_CAPTION_MAX) {
      caption = `${caption.slice(0, TELEGRAM_CAPTION_MAX - 1)}…`;
    }
    try {
      const msgId = await sendTelegramPhoto(botToken, chatId, url, caption);
      if (options.collectMessageIds && msgId != null) {
        messageIds.set(r.id, msgId);
      }
    } catch (e) {
      // Per-row failure shouldn't poison the whole report; log and continue.
      console.error("daily-report sendPhoto failed", { id: r.id, e });
    }
  }
  return messageIds;
}

async function resolvePhotoUrl(
  supabase: Supabase,
  raw: string | null,
): Promise<string | null> {
  if (!raw) return null;
  if (raw.startsWith("sb:")) {
    const path = raw.slice(3);
    const { data } = await supabase.storage
      .from("feedback-photos")
      .createSignedUrl(path, PHOTO_SIGNED_URL_TTL_SEC);
    return data?.signedUrl ?? null;
  }
  // Legacy records: only accept same-project Supabase storage URLs.
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (
    projectUrl &&
    raw.startsWith(`${projectUrl}/storage/v1/object/public/feedback-photos/`)
  ) {
    return raw;
  }
  return null;
}

function formatPhotoCaption(r: FeedRow): string {
  const emoji = r.category_emoji ?? "📝";
  const title = r.category_title ?? r.category;
  const store = r.store_name ?? "магазин не вказано";
  const author = r.user_full_name ?? "анонім";
  let item: string | null = null;
  if (r.product_name) {
    const qty =
      r.quantity != null
        ? ` · ${r.quantity}${r.product_unit ? ` ${r.product_unit}` : ""}`
        : "";
    item = `${r.product_name}${qty}`;
  } else if (typeof r.fields?.["item_name"] === "string") {
    item = r.fields["item_name"] as string;
  }
  const tail = item ? ` · ${item}` : "";
  return `${emoji} ${title} · ${store}${tail} (${author})`;
}

export function getKyivClock(): { hour: number; minute: number } {
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatHumanDateUk(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

// =============================================================================
//                            ФОРМАТУВАННЯ ЗВІТУ
// =============================================================================

interface FormatReportInput {
  todayRows: FeedRow[];
  historyRows: FeedRow[]; // включає todayRows
  todayKyiv: string;
  /**
   * Опціональна мапа feedback_id → click-through URL для 📷 в звіті.
   * Якщо відсутня або порожня — 📷 рендериться як раніше (без лінка).
   */
  photoLinks?: PhotoLinkMap;
}

/**
 * Форматує денний звіт у Telegram-HTML. Складається з блоків:
 *  1. Хедер з KPI (всього + дельта vs середнє за 7 днів).
 *  2. Heatmap-табличка магазини × категорії (в `<pre>` для моноширинного шрифту).
 *  3. Сигнали: повтори браку, дублі товару у різних магазинах, застряглі.
 *  4. Топ-автори за 7 днів.
 *  5. Деталі: списки фідбеків по категоріях (як було у старому звіті, але
 *     compact-list, з повним списком ⩽5 рядків і `+N more` якщо більше).
 *
 * Якщо за день нічого нема — показуємо тільки хедер і застряглих/повтори
 * (якщо є). Інакше повертаємо сухе "сьогодні без фідбеків".
 */
export function formatReport(input: FormatReportInput): string {
  const { todayRows, historyRows, todayKyiv } = input;
  const photoLinks: PhotoLinkMap = input.photoLinks ?? new Map();
  const dateLabel = formatHumanDateUk(todayKyiv);

  const blocks: string[] = [];

  blocks.push(formatHeader(todayRows, historyRows, dateLabel, photoLinks));

  if (todayRows.length === 0) {
    const stuckBlock = formatStuck(historyRows, todayKyiv);
    if (stuckBlock) blocks.push(stuckBlock);
    if (blocks.length === 1) {
      // Зовсім тихо — додамо м'яке завершення.
      blocks.push("Сьогодні без фідбеків.");
    }
    return blocks.join("\n\n");
  }

  blocks.push(formatHeatmap(todayRows));

  const repeatBlock = formatRepeatedDefects(todayRows, historyRows);
  if (repeatBlock) blocks.push(repeatBlock);

  const dupBlock = formatCrossStoreDuplicates(todayRows);
  if (dupBlock) blocks.push(dupBlock);

  const stuckBlock = formatStuck(historyRows, todayKyiv);
  if (stuckBlock) blocks.push(stuckBlock);

  const authorsBlock = formatTopAuthors(historyRows);
  if (authorsBlock) blocks.push(authorsBlock);

  blocks.push(formatDetails(todayRows, photoLinks));

  return blocks.join("\n\n");
}

function formatHeader(
  today: FeedRow[],
  history: FeedRow[],
  dateLabel: string,
  photoLinks: PhotoLinkMap,
): string {
  const stores = new Set(today.map((r) => r.store_name).filter(Boolean));
  const photos = today.filter((r) => r.photo_url).length;
  const lines: string[] = [];
  lines.push(`📊 <b>Звіт за ${escapeHtml(dateLabel)}</b> (Київ)`);

  const fragments: string[] = [
    `${today.length} ${plural(today.length, "фідбек", "фідбеки", "фідбеків")}`,
    `${stores.size} ${plural(stores.size, "магазин", "магазини", "магазинів")}`,
  ];
  if (photos > 0) {
    // Якщо рівно одне фото і є лінк — робимо лічильник клікабельним.
    if (photos === 1 && photoLinks.size === 1) {
      const url = photoLinks.values().next().value as string;
      fragments.push(`${photos} ${linkifyEmoji("📷", url)}`);
    } else {
      fragments.push(`${photos} 📷`);
    }
  }

  // Дельта vs середнє за попередні 7 днів (без сьогодні, щоб порівняння
  // було чесним — інакше ділимо на самих себе).
  const delta = computeDelta(today, history);
  if (delta) fragments.push(delta);

  lines.push(fragments.join(" · "));
  return lines.join("\n");
}

function computeDelta(today: FeedRow[], history: FeedRow[]): string | null {
  const todaySet = new Set(today.map((r) => r.id));
  const past = history.filter((r) => !todaySet.has(r.id));
  // Якщо за останні 7 днів було дуже мало фідбеків — відсоток-дельта
  // не інформативний (1 → 10 = +900%). Не показуємо відсотки, поки база мала.
  const MIN_BASE_FOR_PCT = 7; // мінімум 1/день в середньому.
  if (past.length < MIN_BASE_FOR_PCT) {
    if (today.length === 0 && past.length === 0) return null;
    return `за 7 днів: ${past.length}`;
  }
  const avg = past.length / HISTORY_DAYS;
  const deltaPct = Math.round(((today.length - avg) / avg) * 100);
  const sign = deltaPct >= 0 ? "+" : "−";
  const arrow = deltaPct > 5 ? "▲" : deltaPct < -5 ? "▼" : "▶";
  return `${arrow}${sign}${Math.abs(deltaPct)}% vs сер. ${avg.toFixed(1)}/день`;
}

// -----------------------------------------------------------------------------
// HEATMAP
// -----------------------------------------------------------------------------

const CATEGORY_ORDER: Array<{ id: string; emoji: string }> = [
  { id: "missing_item", emoji: "📉" },
  { id: "overstock", emoji: "📈" },
  { id: "defect", emoji: "💔" },
  { id: "supply_problem", emoji: "📦" },
  { id: "store_idea", emoji: "💡" },
  { id: "spotted_elsewhere", emoji: "👀" },
  { id: "tech_issue", emoji: "🔧" },
  { id: "customer_voice", emoji: "🗣" },
];

function formatHeatmap(rows: FeedRow[]): string {
  // Беремо тільки ті категорії, по яких сьогодні є хоч один рядок.
  const presentCategoryIds = new Set(rows.map((r) => r.category));
  const cols = CATEGORY_ORDER.filter((c) => presentCategoryIds.has(c.id));
  if (cols.length === 0) return "";

  const matrix = new Map<string, Map<string, number>>(); // store → cat → n
  for (const r of rows) {
    const store = r.store_name ?? "—";
    if (!matrix.has(store)) matrix.set(store, new Map());
    const inner = matrix.get(store)!;
    inner.set(r.category, (inner.get(r.category) ?? 0) + 1);
  }

  const storesSorted = Array.from(matrix.entries())
    .map(([store, inner]) => {
      const total = Array.from(inner.values()).reduce((a, b) => a + b, 0);
      return { store, inner, total };
    })
    .sort((a, b) => b.total - a.total);

  // Якщо магазинів дуже багато — зливаємо хвіст у "Інші (N магазинів)".
  let displayRows = storesSorted;
  if (storesSorted.length > HEATMAP_MAX_STORES) {
    const head = storesSorted.slice(0, HEATMAP_MAX_STORES);
    const tail = storesSorted.slice(HEATMAP_MAX_STORES);
    const merged = new Map<string, number>();
    let mergedTotal = 0;
    for (const t of tail) {
      mergedTotal += t.total;
      for (const [k, v] of t.inner) merged.set(k, (merged.get(k) ?? 0) + v);
    }
    displayRows = [
      ...head,
      {
        store: `+ ${tail.length} ${plural(tail.length, "магазин", "магазини", "магазинів")}`,
        inner: merged,
        total: mergedTotal,
      },
    ];
  }

  // Підрахуємо total по кожній колонці.
  const colTotals = new Map<string, number>();
  for (const col of cols) {
    let sum = 0;
    for (const r of displayRows) sum += r.inner.get(col.id) ?? 0;
    colTotals.set(col.id, sum);
  }
  const grandTotal = Array.from(colTotals.values()).reduce((a, b) => a + b, 0);

  // Малюємо моноширинну табличку.
  // Колонки: store_name (динамічно), потім по 4 wide на категорію, потім Σ.
  const STORE_COL = 12;
  const CAT_COL = 4;

  const headerCells = [padRight("", STORE_COL)];
  for (const c of cols) headerCells.push(padCenter(c.emoji, CAT_COL));
  headerCells.push(padCenter("Σ", CAT_COL));

  const lines: string[] = [];
  lines.push(headerCells.join(""));

  for (const row of displayRows) {
    const cells = [padRight(truncDisplay(row.store, STORE_COL - 1), STORE_COL)];
    for (const c of cols) {
      const v = row.inner.get(c.id) ?? 0;
      cells.push(padCenter(v > 0 ? String(v) : "·", CAT_COL));
    }
    cells.push(padCenter(String(row.total), CAT_COL));
    lines.push(cells.join(""));
  }

  // Підсумок Σ.
  const totalCells = [padRight("Σ", STORE_COL)];
  for (const c of cols) totalCells.push(padCenter(String(colTotals.get(c.id) ?? 0), CAT_COL));
  totalCells.push(padCenter(String(grandTotal), CAT_COL));
  lines.push(totalCells.join(""));

  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}

// -----------------------------------------------------------------------------
// СИГНАЛИ
// -----------------------------------------------------------------------------

/**
 * Повтори браку: серед сьогоднішніх defect знайти ті товари (product_id),
 * які за останні 7 днів зустрічались у defect ще хоч раз.
 */
function formatRepeatedDefects(today: FeedRow[], history: FeedRow[]): string {
  const todaysDefects = today.filter((r) => r.category === "defect");
  if (todaysDefects.length === 0) return "";

  const last7Defects = history.filter((r) => r.category === "defect");
  const counts = new Map<number, FeedRow[]>();
  for (const r of last7Defects) {
    if (r.product_id == null) continue;
    const list = counts.get(r.product_id) ?? [];
    list.push(r);
    counts.set(r.product_id, list);
  }

  const repeats: string[] = [];
  const seen = new Set<number>();
  for (const r of todaysDefects) {
    if (r.product_id == null) continue;
    const all = counts.get(r.product_id) ?? [];
    if (all.length < 2) continue;
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    const product = r.product_name ?? `товар #${r.product_id}`;
    const stores = Array.from(
      new Set(all.map((x) => x.store_name).filter(Boolean)),
    ) as string[];
    repeats.push(
      `• ${escapeHtml(product)} — ${escapeHtml(stores.join(", "))} (${all.length}-й випадок за ${HISTORY_DAYS} днів)`,
    );
  }
  if (repeats.length === 0) return "";
  return `🔁 <b>Повтори браку</b> (за ${HISTORY_DAYS} днів)\n${repeats.join("\n")}`;
}

/**
 * Дублі товару у різних магазинах сьогодні: один product_id → ⩾2 магазини.
 */
function formatCrossStoreDuplicates(today: FeedRow[]): string {
  const byProduct = new Map<number, FeedRow[]>();
  for (const r of today) {
    if (r.product_id == null) continue;
    const list = byProduct.get(r.product_id) ?? [];
    list.push(r);
    byProduct.set(r.product_id, list);
  }
  const dups: string[] = [];
  for (const [, rows] of byProduct) {
    const stores = new Set(rows.map((r) => r.store_name).filter(Boolean));
    if (stores.size < 2) continue;
    const head = rows[0]!;
    const product = head.product_name ?? `товар #${head.product_id}`;
    const cats = Array.from(new Set(rows.map((r) => r.category)));
    dups.push(
      `• ${escapeHtml(product)} — ${escapeHtml(Array.from(stores).join(", "))} (${cats.map(catEmoji).join("")})`,
    );
  }
  if (dups.length === 0) return "";
  return `🔀 <b>Той самий товар у різних магазинах</b>\n${dups.join("\n")}`;
}

/**
 * Застряглі: status='new' довше ніж 3 дні. Беремо з історичного вікна,
 * але виключаємо сьогоднішніх (їм же нема ще 3 днів).
 */
function formatStuck(history: FeedRow[], todayKyiv: string): string {
  const now = Date.now();
  const stuck = history
    .filter((r) => r.status === "new")
    .filter(
      (r) =>
        now - new Date(r.created_at).getTime() >
        STUCK_DAYS_THRESHOLD * 24 * 60 * 60 * 1000,
    )
    .filter((r) => kyivDateString(new Date(r.created_at)) !== todayKyiv);
  if (stuck.length === 0) return "";

  // Групуємо по днях, бо інакше довго.
  const lines: string[] = [];
  for (const r of stuck.slice(0, 5)) {
    const d = kyivDateString(new Date(r.created_at));
    const dLabel = formatHumanDateUk(d);
    lines.push(`• ${dLabel} ${catEmoji(r.category)} ${escapeHtml(formatRowSubject(r))}`);
  }
  if (stuck.length > 5) {
    lines.push(`• …і ще ${stuck.length - 5}`);
  }
  return `🐌 <b>Застрягли</b> (status=new &gt; ${STUCK_DAYS_THRESHOLD} днів): ${stuck.length}\n${lines.join("\n")}`;
}

/**
 * Топ-автори за 7 днів — хто пише найбільше фідбеків (= хто більше бачить).
 */
function formatTopAuthors(history: FeedRow[]): string {
  const counts = new Map<string, { name: string; count: number; storeName: string | null }>();
  for (const r of history) {
    const key = r.user_id ?? r.user_full_name ?? "анонім";
    const cur = counts.get(key);
    if (cur) {
      cur.count++;
    } else {
      counts.set(key, {
        name: r.user_full_name ?? "анонім",
        count: 1,
        storeName: r.store_name,
      });
    }
  }
  const top = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_AUTHORS_LIMIT)
    .filter((a) => a.count >= 2);
  if (top.length === 0) return "";
  const lines = top.map(
    (a, i) =>
      `${["🥇", "🥈", "🥉"][i] ?? "•"} ${escapeHtml(a.name)}${
        a.storeName ? ` · ${escapeHtml(a.storeName)}` : ""
      } — ${a.count} ${plural(a.count, "фідбек", "фідбеки", "фідбеків")}`,
  );
  return `👥 <b>Топ-автори</b> (${HISTORY_DAYS} днів)\n${lines.join("\n")}`;
}

// -----------------------------------------------------------------------------
// ДЕТАЛІ ПО КАТЕГОРІЯХ
// -----------------------------------------------------------------------------

function formatDetails(rows: FeedRow[], photoLinks: PhotoLinkMap): string {
  const groups = new Map<string, FeedRow[]>();
  for (const r of rows) {
    const list = groups.get(r.category) ?? [];
    list.push(r);
    groups.set(r.category, list);
  }
  // Пріоритетні категорії (операційні) — показуємо повними блоками
  // на верху. Решту (ідеї, голос клієнта та інше) зливаємо в єдиний
  // блок "Інше" з однорядковими резюме.
  const OPS = ["defect", "missing_item", "overstock", "supply_problem"];
  const opsKeys = OPS.filter((c) => groups.has(c));
  const otherKeys = Array.from(groups.keys()).filter(
    (c) => !OPS.includes(c),
  );

  const sections: string[] = [];
  for (const key of opsKeys) {
    const groupRows = groups.get(key)!;
    const head = groupRows[0]!;
    const emoji = head.category_emoji ?? catEmoji(key);
    const title = head.category_title ?? key;
    const lines: string[] = [];
    lines.push(`${emoji} <b>${escapeHtml(title)}</b> (${groupRows.length})`);
    const limit = 8;
    for (const r of groupRows.slice(0, limit)) {
      lines.push(`• ${formatRowLine(r, photoLinks)}`);
    }
    if (groupRows.length > limit) {
      lines.push(`• …+${groupRows.length - limit}`);
    }
    sections.push(lines.join("\n"));
  }

  if (otherKeys.length > 0) {
    const otherRows: FeedRow[] = [];
    for (const k of otherKeys) otherRows.push(...(groups.get(k) ?? []));
    sections.push(formatOtherBlock(otherRows, photoLinks));
  }
  return sections.join("\n\n");
}

/**
 * Блок "Інше" — характерні для кожної категорії поля витягуємо з fields,
 * щоб однорядкове резюме було корисне (а не великий summary з всіма питаннями).
 */
function formatOtherBlock(rows: FeedRow[], photoLinks: PhotoLinkMap): string {
  const total = rows.length;
  const lines: string[] = [`📋 <b>Інше</b> (${total})`];
  const limit = 6;
  for (const r of rows.slice(0, limit)) {
    const emoji = r.category_emoji ?? catEmoji(r.category);
    const store = escapeHtml(r.store_name ?? "магазин не вказано");
    const subj = escapeHtml(extractOtherSubject(r));
    const photoIcon = renderPhotoIcon(r, photoLinks);
    lines.push(`• ${emoji} ${store} — ${subj}${photoIcon}`);
  }
  if (total > limit) lines.push(`• …+${total - limit}`);
  return lines.join("\n");
}

/** Короткий хук для "Інше" — беремо найбільш осмислене поле кожної категорії. */
function extractOtherSubject(r: FeedRow): string {
  const f = r.fields ?? {};
  const pick = (key: string): string | null => {
    const v = f[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  switch (r.category) {
    case "store_idea":
      return pick("title") ?? pick("detail") ?? "ідея";
    case "customer_voice": {
      const t = pick("topic");
      const q = pick("quote");
      return [t, q ? `«${q}»` : null].filter(Boolean).join(" — ") || "голос клієнта";
    }
    case "tech_issue": {
      const w = pick("what_broken");
      const u = pick("urgency");
      return [w, u ? `(${u})` : null].filter(Boolean).join(" ") || "технічна проблема";
    }
    case "spotted_elsewhere": {
      const where = pick("where");
      const what = pick("what");
      return [where ? `у ${where}` : null, what].filter(Boolean).join(": ") || "підгляділа";
    }
    default: {
      const trimmed = r.summary.length > 80 ? `${r.summary.slice(0, 77)}...` : r.summary;
      return trimmed;
    }
  }
}

function formatRowLine(r: FeedRow, photoLinks: PhotoLinkMap): string {
  const store = escapeHtml(r.store_name ?? "магазин не вказано");
  const author = escapeHtml(r.user_full_name ?? "анонім");
  const photo = renderPhotoIcon(r, photoLinks);

  if (r.product_name) {
    const qty =
      r.quantity != null
        ? ` · ${escapeHtml(String(r.quantity))}${r.product_unit ? ` ${escapeHtml(r.product_unit)}` : ""}`
        : "";
    return `${store} — ${escapeHtml(r.product_name)}${qty}${photo} <i>(${author})</i>`;
  }

  const itemName =
    typeof r.fields?.["item_name"] === "string"
      ? (r.fields["item_name"] as string)
      : null;
  if (itemName) {
    return `${store} — ${escapeHtml(itemName)}${photo} <i>(${author})</i>`;
  }

  const trimmed =
    r.summary.length > 120 ? `${r.summary.slice(0, 117)}...` : r.summary;
  return `${store}${photo} <i>(${author})</i>: ${escapeHtml(trimmed)}`;
}

/** Стислий "subject" рядка: для блоку "Застрягли". */
function formatRowSubject(r: FeedRow): string {
  const store = r.store_name ?? "магазин не вказано";
  if (r.product_name) {
    const qty =
      r.quantity != null
        ? ` · ${r.quantity}${r.product_unit ? ` ${r.product_unit}` : ""}`
        : "";
    return `${r.product_name}${qty} (${store})`;
  }
  const itemName =
    typeof r.fields?.["item_name"] === "string"
      ? (r.fields["item_name"] as string)
      : null;
  if (itemName) return `${itemName} (${store})`;
  const trimmed = r.summary.length > 80 ? `${r.summary.slice(0, 77)}...` : r.summary;
  return `${trimmed} (${store})`;
}

// -----------------------------------------------------------------------------
// utils
// -----------------------------------------------------------------------------

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a value to be safe inside an HTML attribute (e.g. href="..."). */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Wrap an emoji (or any text) in an `<a href="...">` so that clicks open URL. */
function linkifyEmoji(emoji: string, url: string): string {
  return `<a href="${escapeAttr(url)}">${emoji}</a>`;
}

/**
 * Render the 📷 marker for a feedback row. Returns a leading-space-prefixed
 * fragment (or empty string) so callers can append unconditionally:
 *
 *   ` 📷`              ← row has photo, no link available
 *   ` <a href="...">📷</a>`  ← row has photo with click-through link
 *   ``                  ← no photo
 */
function renderPhotoIcon(r: FeedRow, photoLinks: PhotoLinkMap): string {
  if (!r.photo_url) return "";
  const url = photoLinks.get(r.id);
  return ` ${url ? linkifyEmoji("📷", url) : "📷"}`;
}

function catEmoji(id: string): string {
  return CATEGORY_ORDER.find((c) => c.id === id)?.emoji ?? "📝";
}

/**
 * Ширина символу у моноширинному рендері Telegram. Для більшості емодзі
 * Telegram займає 2 cell, тому ми це враховуємо при паддінгу heatmap.
 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of Array.from(s)) {
    const cp = ch.codePointAt(0)!;
    // Емодзі-плейн (U+1F000–U+1FFFF) + різноманітні supp-symbols (U+2600+).
    if (
      (cp >= 0x1f000 && cp <= 0x1fffff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      cp === 0xfe0f /* variation selector після emoji */
    ) {
      // VS-15/16 не додають ширини самі по собі.
      if (cp === 0xfe0f) continue;
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padRight(s: string, width: number): string {
  const w = displayWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

function padCenter(s: string, width: number): string {
  const w = displayWidth(s);
  if (w >= width) return s;
  const total = width - w;
  const left = Math.floor(total / 2);
  const right = total - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

function truncDisplay(s: string, maxWidth: number): string {
  let w = 0;
  let out = "";
  for (const ch of Array.from(s)) {
    const cw = displayWidth(ch);
    if (w + cw > maxWidth) {
      // Залишаємо місце під крапку, якщо можна.
      return out.trimEnd() + (maxWidth >= 1 ? "…" : "");
    }
    out += ch;
    w += cw;
  }
  return out;
}

// =============================================================================
//                          TELEGRAM SEND HELPERS
// =============================================================================

/**
 * Надсилає HTML-форматоване повідомлення. Розбиває на чанки по `\n\n`,
 * щоб не порвати теги — попередній імпл різав по 4000 char, що ламало
 * `<pre>` блоки з heatmap. Тепер chunk = sequence of paragraphs до 3800
 * символів.
 */
async function sendTelegramHtml(
  botToken: string,
  chatId: string,
  html: string,
): Promise<void> {
  const MAX = 3800;
  const paragraphs = html.split("\n\n");
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf.length + p.length + 2 > MAX && buf.length > 0) {
      chunks.push(buf);
      buf = "";
    }
    if (p.length > MAX) {
      // Один абзац більший за ліміт — ріжемо все ж по символах.
      for (let i = 0; i < p.length; i += MAX) chunks.push(p.slice(i, i + MAX));
      continue;
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) chunks.push(buf);

  for (const chunk of chunks) {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "HTML",
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

async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption: string,
): Promise<number | null> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendPhoto`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("telegram sendPhoto failed", {
      status: res.status,
      body: body.slice(0, 300),
    });
    throw new Error(`telegram_photo_failed_${res.status}`);
  }
  try {
    const json = (await res.json()) as {
      ok: boolean;
      result?: { message_id?: number };
    };
    return json.result?.message_id ?? null;
  } catch {
    return null;
  }
}
