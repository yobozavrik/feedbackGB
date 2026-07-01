import type { FeedRow } from "@/app/(admin)/admin/page";

// Presentation helpers shared by the feed table (admin-client.tsx) and
// the feed drawer (components/admin/feed/FeedDrawer.tsx).

export interface CategoryMeta {
  id: string;
  title: string;
  emoji: string;
  tint: string;
}

export const TINT_COLOR: Record<string, string> = {
  missing: "orange",
  overstock: "blue",
  defect: "red",
  supply: "geekblue",
  idea: "purple",
  spotted: "cyan",
  tech: "gold",
  voice: "magenta",
};

export function formatRelative(iso: string): string {
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

export function authorOf(r: FeedRow): string {
  return (
    r.user_full_name ||
    r.tg_display_name ||
    r.tg_username ||
    "анонім"
  );
}
