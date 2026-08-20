const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function formattedParts(value: Date, timeZone: string): DateTimeParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const result = {
      year: read('year'), month: read('month'), day: read('day'),
      hour: read('hour'), minute: read('minute'),
    };
    return Object.values(result).every(Number.isInteger) ? result : null;
  } catch {
    return null;
  }
}

function wallClockValue(parts: DateTimeParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

export function zonedLocalDateTimeToIso(value: unknown, timeZone: unknown) {
  if (typeof value !== 'string' || typeof timeZone !== 'string' || timeZone.length > 64) return null;
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const target = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  const targetValue = wallClockValue(target);
  if (!Number.isFinite(targetValue)) return null;
  let instant = targetValue;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const displayed = formattedParts(new Date(instant), timeZone);
    if (!displayed) return null;
    const difference = targetValue - wallClockValue(displayed);
    instant += difference;
    if (difference === 0) break;
  }
  const verified = formattedParts(new Date(instant), timeZone);
  return verified && wallClockValue(verified) === targetValue
    ? new Date(instant).toISOString()
    : null;
}
