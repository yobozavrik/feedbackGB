const KYIV_TIMEZONE = "Europe/Kyiv";
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})$/;

function kyivParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return {
    year: value("year")!,
    month: value("month")!,
    day: value("day")!,
    hour: value("hour")!,
    minute: value("minute")!,
  };
}

function keyForKyivInstant(date: Date) {
  const parts = kyivParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * Converts a wall-clock value entered for a Kyiv store to an ISO instant.
 * A clock value which does not exist during the spring DST transition is
 * rejected rather than silently moved to another hour. For the repeated hour
 * in autumn the earlier instant is consistently selected.
 */
export function kyivWallTimeToIso(date: string, time: string): string {
  const source = `${date} ${time}`;
  const match = DATE_TIME.exec(source);
  if (!match) throw new Error("Некоректні дата або час зміни");

  const expected = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const candidates = new Set<number>();

  // The offset is looked up around the desired wall-clock value. Searching a
  // small window also covers both sides of the one-hour DST boundary.
  for (const deltaMinutes of [-180, -120, -60, 0, 60, 120, 180]) {
    const reference = new Date(expected + deltaMinutes * 60_000);
    const local = kyivParts(reference);
    const offset = Date.UTC(
      Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute),
    ) - reference.getTime();
    const instant = expected - offset;
    if (keyForKyivInstant(new Date(instant)) === source) candidates.add(instant);
  }

  const first = [...candidates].sort((a, b) => a - b)[0];
  if (first == null) {
    throw new Error("Цей час не існує у часовому поясі Києва. Оберіть інший час.");
  }
  return new Date(first).toISOString();
}

export function kyivDateTimeParts(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("Некоректний час зміни");
  const parts = kyivParts(date);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function currentKyivMonth(): string {
  const parts = kyivParts(new Date());
  return `${parts.year}-${parts.month}`;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** All Kyiv-local calendar dates that belong to a selected schedule month. */
export function kyivMonthDates(month: string): string[] {
  const match = MONTH.exec(month);
  if (!match) throw new Error("Некоректний місяць графіка");

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

/**
 * Builds the new interval after dropping a same-day shift into a new Kyiv date.
 * Overnight shifts deliberately require the regular edit form: moving them by a
 * single day cell would otherwise make their end date ambiguous.
 */
export function moveSameDayShiftToKyivDate(startsAt: string, endsAt: string, targetDate: string) {
  const start = kyivDateTimeParts(startsAt);
  const end = kyivDateTimeParts(endsAt);
  if (start.date !== end.date) {
    throw new Error("Нічну зміну потрібно перемістити через форму редагування");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("Некоректна дата призначення");
  }

  return {
    starts_at: kyivWallTimeToIso(targetDate, start.time),
    ends_at: kyivWallTimeToIso(targetDate, end.time),
  };
}

const UKRAINE_FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "Новий рік",
  "03-08": "Міжнародний жіночий день",
  "05-01": "День праці",
  "05-08": "День пам’яті та перемоги",
  "06-28": "День Конституції України",
  "07-15": "День Української Державності",
  "08-24": "День Незалежності України",
  "10-01": "День захисників і захисниць України",
  "12-25": "Різдво Христове",
};

function asDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Orthodox Easter in the Gregorian calendar, valid for the app's modern schedule years. */
function orthodoxEasterDate(year: number) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const julianMonth = Math.floor((d + e + 114) / 31);
  const julianDay = ((d + e + 114) % 31) + 1;
  // The Julian/Gregorian offset is 13 days from 1900 through 2099.
  return addUtcDays(new Date(Date.UTC(year, julianMonth - 1, julianDay)), 13);
}

/**
 * Calendar-only signal for Ukrainian public/religious holidays. It does not
 * decide whether the network works or whether a seller receives time off.
 */
export function ukraineHolidayName(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Некоректна календарна дата");
  const fixed = UKRAINE_FIXED_HOLIDAYS[`${match[2]}-${match[3]}`];
  if (fixed) return fixed;

  const year = Number(match[1]);
  const easter = orthodoxEasterDate(year);
  if (date === asDateKey(easter)) return "Великдень";
  if (date === asDateKey(addUtcDays(easter, 49))) return "Трійця";
  return null;
}

export function isSaturdayOrSunday(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Некоректна календарна дата");
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
