import type { Category } from "@/lib/categories";

// C2/C5: category tint -> full Tailwind class name, spelled out so the
// content scanner (which only matches literal strings, never
// `` `bg-cat-${x}` ``) generates every variant, not just the ones already
// written elsewhere verbatim.
export const CATEGORY_TINT_BG: Record<Category["tint"], string> = {
  missing: "bg-cat-missing",
  overstock: "bg-cat-overstock",
  defect: "bg-cat-defect",
  supply: "bg-cat-supply",
  idea: "bg-cat-idea",
  spotted: "bg-cat-spotted",
  tech: "bg-cat-tech",
  voice: "bg-cat-voice",
  hr: "bg-cat-hr",
  photo: "bg-cat-photo",
};
