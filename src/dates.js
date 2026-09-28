const MULTIPLIERS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

const pad = n => String(Math.abs(n)).padStart(2, '0');

function dayString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localISO(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${dayString(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function allDay(d) {
  const start = startOfDay(d);
  return { date: dayString(start), ts: start.getTime() };
}

/**
 * Parses a user-supplied date into { date, ts } where `date` is the stored display
 * value (YYYY-MM-DD for all-day, local ISO 8601 otherwise) and `ts` is the epoch ms
 * used for sorting and range filtering. Returns null if unparseable.
 */
const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?`;
const NAIVE_DAY = new RegExp(String.raw`^(today|tomorrow|(\d{4})-(\d{2})-(\d{2}))(?:[t ]${TIME})?$`);
const NAIVE_TIME = new RegExp(`^${TIME}$`);

/**
 * Builds a local-time result from calendar parts. Offset-less input is always taken
 * in the machine's timezone. Without a time the result is all-day.
 */
function fromParts(y, m, d, time) {
  const day = new Date(y, m - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return null;
  if (!time) return allDay(day);

  const [h, min, sec] = time;
  if (h > 23 || min > 59 || sec > 59) return null;
  const date = new Date(y, m - 1, d, h, min, sec);
  return { date: localISO(date), ts: date.getTime() };
}

export function parseDate(input) {
  const s = input.trim().toLowerCase();
  const now = new Date();

  const relative = s.match(/^\+(\d+)([mhdw])$/);
  if (relative) {
    const d = new Date(now.getTime() + parseInt(relative[1], 10) * MULTIPLIERS[relative[2]]);
    return { date: localISO(d), ts: d.getTime() };
  }

  const timeOnly = s.match(NAIVE_TIME);
  if (timeOnly) {
    const time = timeOnly.slice(1, 4).map(n => +(n ?? 0));
    return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate(), time);
  }

  const naive = s.match(NAIVE_DAY);
  if (naive) {
    const [, word, y, m, d, h, min, sec] = naive;
    const time = h !== undefined ? [+h, +min, +(sec ?? 0)] : null;
    if (word === 'today' || word === 'tomorrow') {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (word === 'tomorrow' ? 1 : 0));
      return fromParts(base.getFullYear(), base.getMonth() + 1, base.getDate(), time);
    }
    return fromParts(+y, +m, +d, time);
  }

  // Anything else (e.g. ISO 8601 with Z or an explicit offset) keeps its own zone.
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) return null;
  return { date: localISO(parsed), ts: parsed.getTime() };
}

/** Exclusive upper bound (epoch ms) for a list range; null means unbounded. */
export function rangeEnd(range) {
  const now = new Date();
  if (range === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  }
  if (range === 'week') {
    // Weeks run Monday–Sunday; the bound is the start of next Monday.
    const daysToMonday = ((8 - now.getDay()) % 7) || 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday).getTime();
  }
  return null;
}

/** Display form of a stored date: "YYYY-MM-DD" as-is, datetimes as local "YYYY-MM-DD HH:MM". */
export function displayDate(date) {
  if (date.length === 10) return date;
  const d = new Date(date);
  return `${dayString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
