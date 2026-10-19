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
