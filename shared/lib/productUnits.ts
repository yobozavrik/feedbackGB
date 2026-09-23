/** Display-only labels for Poster measurement codes. Do not change persisted/API values. */
const UKRAINIAN_UNITS: Record<string, string> = {
  kg: "кг",
  g: "г",
  l: "л",
  ml: "мл",
  p: "шт",
  pc: "шт",
  pcs: "шт",
  piece: "шт",
  pieces: "шт",
  кг: "кг",
  г: "г",
  л: "л",
  мл: "мл",
  шт: "шт",
};

export function formatProductUnitUk(unit: string | null | undefined): string | null {
  const code = unit?.trim().toLowerCase();
  if (!code) return null;
  return UKRAINIAN_UNITS[code] ?? "Невідома одиниця";
}
