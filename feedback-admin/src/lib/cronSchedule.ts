/**
 * Перетворити cron-вираз UTC на людський опис у Києві.
 * EET = UTC+2 (зима), EEST = UTC+3 (літо), тому показуємо діапазон
 * "HH:MM_winter–HH:MM_summer" — Vercel запускає щоденний звіт двома cron-ами,
 * сервер сам обирає правильну DST-фазу.
 * Підтримує лише формат "M H * * *" (щодня).
 */
export function describeCronUtc(expr: string): string {
  const parts = expr.split(" ").filter(Boolean);
  if (parts.length !== 5) return expr;
  const [m, h, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return expr;
  const minute = parseInt(m, 10);
  const hour = parseInt(h, 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return expr;
  const utc = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`;
  const kyivWinter = (hour + 2) % 24;
  const kyivSummer = (hour + 3) % 24;
  const fmt = (h2: number) =>
    `${String(h2).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `щодня ${fmt(kyivWinter)}–${fmt(kyivSummer)} (Київ, зима–літо) · ${utc}`;
}
