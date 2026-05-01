"use client";

import { useMemo, useState } from "react";
import type { FeedRow } from "./page";

type Period = "all" | "today" | "week" | "month";

interface CategoryMeta {
  id: string;
  title: string;
  emoji: string;
  tint: string;
}

interface Props {
  rows: FeedRow[];
  stores: string[];
  categories: CategoryMeta[];
}

const TINT_BG: Record<string, string> = {
  missing: "bg-cat-missing/40",
  overstock: "bg-cat-overstock/40",
  defect: "bg-cat-defect/40",
  supply: "bg-cat-supply/40",
  idea: "bg-cat-idea/40",
  spotted: "bg-cat-spotted/40",
  tech: "bg-cat-tech/40",
  voice: "bg-cat-voice/40",
};

export function AdminClient({ rows, stores, categories }: Props) {
  const [period, setPeriod] = useState<Period>("all");
  const [storeFilter, setStoreFilter] = useState<string>("");
  const [catFilter, setCatFilter] = useState<string>("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = (() => {
      switch (period) {
        case "today":
          return now - 24 * 60 * 60 * 1000;
        case "week":
          return now - 7 * 24 * 60 * 60 * 1000;
        case "month":
          return now - 30 * 24 * 60 * 60 * 1000;
        default:
          return 0;
      }
    })();
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (cutoff && new Date(r.created_at).getTime() < cutoff) return false;
      if (storeFilter && r.store_name !== storeFilter) return false;
      if (catFilter && r.category !== catFilter) return false;
      if (q && !`${r.summary} ${r.store_name ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, period, storeFilter, catFilter, query]);

  const newCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          new Date(r.created_at).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).length,
    [rows],
  );

  const periodLabels: Record<Period, string> = {
    all: "Все",
    today: "Сьогодні",
    week: "Тиждень",
    month: "Місяць",
  };

  return (
    <div>
      {/* Admin actions hero */}
      <section className="mb-5">
        <h1 className="mb-2 px-1 font-display text-[22px] font-semibold text-ink-900">
          Адмін-панель
        </h1>
        <p className="mb-3 px-1 text-[12px] text-ink-500">
          Дії адміна. Натисни кнопку у потрібній картці.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ActionCard
            emoji="📤"
            title="Надіслати звіт у Telegram"
            description="Зібрати всі сьогоднішні фідбеки і надіслати у групу зараз — не чекаючи 21:30."
          >
            <SendReportNowButton />
          </ActionCard>
          <ActionCard
            emoji="📦"
            title="Дзеркалити фото у Drive"
            description="Скопіювати нові фото з Supabase у папку Google Drive (резервна копія)."
          >
            <MirrorToDriveNowButton />
          </ActionCard>
          <ActionCard
            emoji="👥"
            title="Користувачі та PIN"
            description="Перевидати PIN продавчиням, розблокувати акаунт після 10 невдалих спроб."
          >
            <a
              href="/admin/users"
              className="pill bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-bg"
            >
              Відкрити
            </a>
          </ActionCard>
          <ActionCard
            emoji="🔍"
            title="Журнал дій"
            description="Усі входи, фідбеки, адмін-дії: хто, коли, з якого IP. Останні 500 подій."
          >
            <a
              href="/admin/audit"
              className="pill bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-bg"
            >
              Відкрити
            </a>
          </ActionCard>
          <ActionCard
            emoji="📥"
            title="Експорт фідбеків"
            description="Завантажити поточну стрічку у вигляді JSON або CSV для роботи в Excel/Google Sheets."
          >
            <div className="flex flex-wrap gap-1.5">
              <a
                href="/api/feedback?format=json"
                className="pill bg-elev2 px-3 py-1.5 text-[12px] font-medium text-ink-900"
              >
                JSON
              </a>
              <a
                href="/api/feedback?format=csv"
                className="pill bg-elev2 px-3 py-1.5 text-[12px] font-medium text-ink-900"
              >
                CSV
              </a>
            </div>
          </ActionCard>
        </div>
      </section>

      {/* Feed header */}
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="font-display text-[18px] font-semibold text-ink-900">
          Стрічка фідбеку
        </h2>
        <span className="pill bg-elev2 text-ink-700">
          {newCount} нових за 7 днів
        </span>
      </div>

      {/* Period segment + search */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex gap-1 rounded-full bg-elev2 p-1">
          {(Object.keys(periodLabels) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${
                period === p
                  ? "bg-ink-900 text-bg shadow-soft"
                  : "text-ink-700 hover:text-ink-900"
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Пошук"
          className="field-input flex-1 !h-10 !text-[13px]"
        />
      </div>

      {/* Store + Category filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="h-9 rounded-full border border-ink-300/40 bg-elev2 px-3 text-[12px] text-ink-900"
        >
          <option value="">Усі магазини</option>
          {stores.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="h-9 rounded-full border border-ink-300/40 bg-elev2 px-3 text-[12px] text-ink-900"
        >
          <option value="">Усі категорії</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.title}
            </option>
          ))}
        </select>
        {(storeFilter || catFilter || query || period !== "all") && (
          <button
            type="button"
            onClick={() => {
              setStoreFilter("");
              setCatFilter("");
              setQuery("");
              setPeriod("all");
            }}
            className="rounded-full px-3 py-1 text-[12px] text-ink-500 underline-offset-2 hover:underline"
          >
            скинути
          </button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl">🌸</div>
          <p className="mt-3 text-[14px] text-ink-700">
            {rows.length === 0
              ? "Поки що тихо. Перші фідбеки скоро з'являться."
              : "Нічого не знайдено за цими фільтрами."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r, idx) => (
            <FeedCard key={r.id} row={r} categories={categories} idx={idx} />
          ))}
        </ul>
      )}

    </div>
  );
}

function ActionCard({
  emoji,
  title,
  description,
  children,
}: {
  emoji: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <span className="text-[22px] leading-none" aria-hidden>
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-ink-900">{title}</h3>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function FeedCard({
  row: r,
  categories,
  idx,
}: {
  row: FeedRow;
  categories: CategoryMeta[];
  idx: number;
}) {
  const cat = categories.find((c) => c.id === r.category);
  const tintClass = (cat && TINT_BG[cat.tint]) ?? "bg-elev2";
  const author =
    r.user_full_name || r.tg_display_name || r.tg_username || "анонім";
  const fieldEntries = r.fields ? Object.entries(r.fields) : [];

  return (
    <li
      className="card animate-fade-up overflow-hidden p-4"
      style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`pill ${tintClass} text-ink-900`}>
          <span aria-hidden>{r.category_emoji ?? cat?.emoji ?? "📝"}</span>
          {r.category_title ?? cat?.title ?? r.category}
        </span>
        <span className="text-[11px] font-medium text-ink-500">
          {formatRelative(r.created_at)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-700">
        {r.store_name ? (
          <span className="pill bg-elev2 text-ink-700">
            <span aria-hidden>📍</span>
            {r.store_name}
          </span>
        ) : null}
        <span className="text-ink-500">·</span>
        <span className="text-ink-500">{author}</span>
        {r.status && r.status !== "new" ? (
          <span className="pill bg-amber-400/20 text-ink-900">
            {translateStatus(r.status)}
          </span>
        ) : null}
      </div>

      {fieldEntries.length > 0 ? (
        <dl className="mt-3 space-y-1.5">
          {fieldEntries.map(([k, v]) =>
            v == null || v === "" ? null : (
              <div key={k} className="flex flex-col">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                  {k}
                </dt>
                <dd className="whitespace-pre-wrap text-[14px] leading-snug text-ink-900">
                  {String(v)}
                </dd>
              </div>
            ),
          )}
        </dl>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-snug text-ink-700">
          {r.summary}
        </p>
      )}

      {r.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.photo_url}
          alt="фото"
          className="mt-3 max-h-48 rounded-xl object-cover"
        />
      ) : null}
    </li>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} год тому`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн тому`;
  return new Date(iso).toLocaleDateString("uk-UA");
}

function translateStatus(s: string): string {
  switch (s) {
    case "in_progress":
      return "В роботі";
    case "resolved":
      return "Закрито";
    case "duplicate":
      return "Дубль";
    default:
      return s;
  }
}

function SendReportNowButton() {
  const [status, setStatus] = useState<
    "idle" | "sending" | "ok" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    if (status === "sending") return;
    if (
      !confirm("Надіслати щоденний звіт у Telegram-групу прямо зараз?")
    ) {
      return;
    }
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/send-report-now", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        total?: number;
      };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? `Помилка ${res.status}`);
      } else {
        setStatus("ok");
        setMessage(
          typeof data.total === "number"
            ? `Надіслано (${data.total} рядків)`
            : "Надіслано",
        );
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Помилка мережі");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "sending"}
        className="pill bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-bg disabled:opacity-50"
      >
        {status === "sending" ? "Надсилаю..." : "📤 Надіслати звіт зараз"}
      </button>
      {message ? (
        <span
          className={`text-[12px] ${
            status === "error" ? "text-rose-700" : "text-ink-500"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}

function MirrorToDriveNowButton() {
  const [status, setStatus] = useState<
    "idle" | "sending" | "ok" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    if (status === "sending") return;
    if (!confirm("Скопіювати нові фото у Google Drive зараз?")) return;
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mirror-to-drive-now", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mirrored?: number;
        failed?: number;
        skipped?: number;
      };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? `Помилка ${res.status}`);
      } else {
        setStatus("ok");
        const m = data.mirrored ?? 0;
        const f = data.failed ?? 0;
        setMessage(
          f > 0
            ? `Скопійовано ${m}, помилок ${f}`
            : `Скопійовано ${m}`,
        );
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Помилка мережі");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "sending"}
        className="pill bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-bg disabled:opacity-50"
      >
        {status === "sending" ? "Копіюю..." : "📦 Дзеркало у Drive"}
      </button>
      {message ? (
        <span
          className={`text-[12px] ${
            status === "error" ? "text-rose-700" : "text-ink-500"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
