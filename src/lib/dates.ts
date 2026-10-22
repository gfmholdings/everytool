// Date math for the Days counter. Everything is calendar-local and
// DST-proof: day differences are computed on UTC midnights of the local
// calendar dates, and the year/month breakdown advances with the day
// clamped to the target month, so month-end starts never go negative
// (Jan 31 → Mar 1 is 1 month + 1 day, not 1 month − 2 days).

export function daysBetween(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000;
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / ms);
}

export interface YmdBreakdown {
  years: number;
  months: number;
  days: number;
}

/** Add whole months, clamping the day to the last day of the target month. */
export function addMonthsClamped(d: Date, months: number): Date {
  const total = d.getFullYear() * 12 + d.getMonth() + months;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), lastDay));
}

/**
 * Calendar breakdown from the earlier date to the later one: whole years,
 * then whole months (day clamped), then the remaining days. The result is
 * never negative in any component, regardless of argument order.
 */
export function breakdownYMD(from: Date, to: Date): YmdBreakdown {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  let years = end.getFullYear() - start.getFullYear();
  let cursor = addMonthsClamped(start, years * 12);
  if (cursor > end) {
    years -= 1;
    cursor = addMonthsClamped(start, years * 12);
  }
  let months =
    (end.getFullYear() - cursor.getFullYear()) * 12 +
    (end.getMonth() - cursor.getMonth());
  let cursor2 = addMonthsClamped(cursor, months);
  if (cursor2 > end) {
    months -= 1;
    cursor2 = addMonthsClamped(cursor, months);
  }
  return { years, months, days: daysBetween(cursor2, end) };
}

/**
 * Day span used by Between and Until.
 * With includeEnds off, this is the midnight difference (today → a date
 * 100 days out is 100). With it on, both ends count, so that span is 101
 * and a single day is 1. The sign stays with the direction of the range.
 */
export function countedDays(from: Date, to: Date, includeEnds = false): number {
  const diff = daysBetween(from, to);
  if (!includeEnds) return diff;
  if (diff > 0) return diff + 1;
  if (diff < 0) return diff - 1;
  return 1;
}

/**
 * Year/month/day breakdown for the same span as countedDays.
 * Including the ends is the exclusive breakdown to the day after the
 * later date, so "3 months 8 days" becomes "3 months 9 days".
 */
export function countedBreakdown(from: Date, to: Date, includeEnds = false): YmdBreakdown {
  if (!includeEnds) return breakdownYMD(from, to);
  const forward = daysBetween(from, to) >= 0;
  const start = forward ? from : to;
  const end = forward ? to : from;
  const next = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  return breakdownYMD(start, next);
}

/** Whole days from today (local) until `date`. Negative if it has passed. */
export function daysUntil(date: Date, today: Date = new Date()): number {
  return daysBetween(today, date);
}

/** Age in days: from a birth date to today (or an explicit "now"). */
export function ageInDays(birth: Date, today: Date = new Date()): number {
  return Math.max(0, daysBetween(birth, today));
}

/** Render a breakdown as plain words: "1 year 2 months 3 days". */
export function formatBreakdown(b: YmdBreakdown): string {
  const parts: string[] = [];
  if (b.years) parts.push(`${b.years} year${b.years === 1 ? '' : 's'}`);
  if (b.months) parts.push(`${b.months} month${b.months === 1 ? '' : 's'}`);
  if (b.days || parts.length === 0)
    parts.push(`${b.days} day${b.days === 1 ? '' : 's'}`);
  return parts.join(' ');
}
