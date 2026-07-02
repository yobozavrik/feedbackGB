// Canonical relative/absolute time formatting for admin pages
// (stores, settings). Previously duplicated per page.
//
// NOTE: the feed uses feedFormat.formatRelative instead — it deliberately
// switches to an absolute date after 7 days, while this one keeps counting
// in months/years. Different product choices, not drift.

export function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "щойно";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн тому`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} міс тому`;
  return `${Math.floor(mo / 12)} р тому`;
}

export function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
