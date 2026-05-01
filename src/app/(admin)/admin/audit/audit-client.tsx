"use client";

import { useMemo, useState } from "react";
import type { AuditRow } from "./page";

type SectionFilter = "all" | "auth" | "feedback" | "admin";

interface Props {
  rows: AuditRow[];
}

export function AuditClient({ rows }: Props) {
  const [section, setSection] = useState<SectionFilter>("all");
  const [actorFilter, setActorFilter] = useState<string>("");

  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.actor_user_id && r.actor_full_name) {
        seen.set(r.actor_user_id, r.actor_full_name);
      }
    }
    return Array.from(seen.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "uk"),
    );
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (section !== "all" && !r.action.startsWith(`${section}.`)) {
        return false;
      }
      if (actorFilter && r.actor_user_id !== actorFilter) {
        return false;
      }
      return true;
    });
  }, [rows, section, actorFilter]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h1 className="font-display text-[22px] font-semibold text-ink-900">
          Журнал дій
        </h1>
        <span className="pill bg-elev2 text-ink-700">{filtered.length}</span>
      </div>

      <p className="mb-4 px-1 text-[12px] text-ink-500">
        Останні 500 подій: входи, фідбеки, адмін-дії. Видно хто зробив, коли,
        з якого IP.
      </p>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex gap-1 rounded-full bg-elev2 p-1">
          {(["all", "auth", "feedback", "admin"] as SectionFilter[]).map(
            (s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                className={`pill px-3 py-1 text-[12px] font-medium ${
                  section === s
                    ? "bg-ink-900 text-bg"
                    : "bg-transparent text-ink-700"
                }`}
              >
                {sectionLabel(s)}
              </button>
            ),
          )}
        </div>

        {actorOptions.length > 0 ? (
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded-full bg-elev2 px-3 py-1.5 text-[12px] font-medium text-ink-900"
          >
            <option value="">Усі користувачі</option>
            {actorOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl">🌸</div>
          <p className="mt-3 text-[14px] text-ink-700">
            За цими фільтрами поки нічого нема.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <AuditCard key={r.id} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function sectionLabel(s: SectionFilter): string {
  switch (s) {
    case "all":
      return "Усе";
    case "auth":
      return "🔑 Вхід";
    case "feedback":
      return "📝 Фідбек";
    case "admin":
      return "🛠 Адмін";
  }
}

function AuditCard({ row: r }: { row: AuditRow }) {
  const failed = r.action === "auth.login.failure";
  return (
    <li
      className={`card p-3 text-[13px] ${
        failed ? "border border-rose-300/40 bg-rose-50/40" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="pill bg-elev2 text-[11px] text-ink-700">
          {r.section}
        </span>
        <span className="text-[11px] font-medium text-ink-500">
          {formatTime(r.occurred_at)}
        </span>
      </div>
      <p className="mt-1.5 text-[14px] font-medium text-ink-900">
        {r.action_title}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-500">
        {r.actor_full_name ? (
          <span>
            <span aria-hidden>👤</span> {r.actor_full_name}
            {r.actor_role === "admin" ? " (адмін)" : ""}
          </span>
        ) : r.actor_user_id ? (
          <span className="font-mono">{r.actor_user_id.slice(0, 8)}…</span>
        ) : (
          <span>· anon</span>
        )}
        {r.target_full_name ? (
          <span>
            → <span aria-hidden>🎯</span> {r.target_full_name}
          </span>
        ) : null}
        {r.ip ? (
          <span className="font-mono">
            <span aria-hidden>📡</span> {r.ip}
          </span>
        ) : null}
      </div>
      {r.meta && Object.keys(r.meta).length > 0 ? (
        <pre className="mt-1.5 overflow-x-auto rounded-lg bg-elev2 px-2 py-1.5 text-[11px] leading-snug text-ink-700">
          {JSON.stringify(r.meta, null, 0)}
        </pre>
      ) : null}
    </li>
  );
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  const now = new Date();
  const sameDay =
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate();
  if (sameDay) {
    return t.toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return t.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
