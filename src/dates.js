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
export function parseDate(input) {
  const s = input.trim().toLowerCase();
  const now = new Date();

  if (s === 'today') return allDay(now);
  if (s === 'tomorrow') return allDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  const relative = s.match(/^\+(\d+)([mhdw])$/);
  if (relative) {
    const d = new Date(now.getTime() + parseInt(relative[1], 10) * MULTIPLIERS[relative[2]]);
    return { date: localISO(d), ts: d.getTime() };
  }

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const [y, m, d] = [+ymd[1], +ymd[2], +ymd[3]];
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return allDay(date);
  }

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
