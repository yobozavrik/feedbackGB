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
