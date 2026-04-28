import { Header } from "@/components/Header";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/categories";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  created_at: string;
  category: string;
  store: string | null;
  tg_display_name: string | null;
  tg_username: string | null;
  summary: string;
  photo_url: string | null;
}

async function fetchRows(): Promise<{ rows: Row[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { rows: [], error: "Supabase ще не налаштовано" };
  }
  const { data, error } = await supabase
    .from("feedback")
    .select(
      "id, created_at, category, store, tg_display_name, tg_username, summary, photo_url",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as Row[]) ?? [], error: null };
}

export default async function AdminPage() {
  const { rows, error } = await fetchRows();

  return (
    <main>
      <Header subtitle="Стрічка фідбеку" />

      {!isSupabaseConfigured() ? (
        <div className="card mb-4 p-5 text-sm leading-relaxed text-ink-700">
          <p className="font-medium text-ink-900">Supabase не підключено</p>
          <p className="mt-1">
            Додай у `.env`: <code className="rounded bg-blush-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            та{" "}
            <code className="rounded bg-blush-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
            (або anon), потім застосуй <code>supabase/schema.sql</code>.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="card mb-4 border-blush-200 p-5 text-sm text-blush-600">
          Помилка: {error}
        </div>
      ) : null}

      {rows.length === 0 && !error ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          Поки що немає фідбеку. Будь першою 🌸
        </div>
      ) : null}

      <ul className="space-y-3">
        {rows.map((r) => {
          const cat = CATEGORIES.find((c) => c.id === r.category);
          const date = new Date(r.created_at).toLocaleString("uk-UA");
          return (
            <li
              key={r.id}
              className={`card overflow-hidden bg-gradient-to-br ${cat?.gradient ?? "from-white to-white"} p-4`}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl">{cat?.emoji ?? "📝"}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-ink-900">
                      {cat?.title ?? r.category}
                    </span>
                    <span className="text-[11px] text-ink-500">{date}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    {r.store || "—"} •{" "}
                    {r.tg_display_name || r.tg_username || "анонім"}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-snug text-ink-700">
                    {r.summary}
                  </p>
                  {r.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.photo_url}
                      alt="фото"
                      className="mt-2 max-h-48 rounded-xl object-cover"
                    />
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 text-center text-xs text-ink-500">
        Експорт у CSV / JSON: <code>/api/feedback?format=json</code>
      </div>
    </main>
  );
}
