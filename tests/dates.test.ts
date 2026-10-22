import assert from 'node:assert/strict';
import test from 'node:test';

import {
  breakdownYMD,
  countedBreakdown,
  countedDays,
  daysBetween,
  formatBreakdown,
} from '../src/lib/dates.ts';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

test('daysBetween counts whole days in both directions', () => {
  assert.equal(daysBetween(d(2026, 1, 1), d(2026, 1, 2)), 1);
  assert.equal(daysBetween(d(2026, 1, 2), d(2026, 1, 1)), -1);
  assert.equal(daysBetween(d(2026, 1, 1), d(2026, 1, 1)), 0);
  assert.equal(daysBetween(d(2025, 12, 31), d(2026, 1, 1)), 1);
  // Across a DST change the count stays exact (UTC-normalized).
  assert.equal(daysBetween(d(2026, 3, 7), d(2026, 3, 9)), 2);
});

test('month-end clamping: Jan 31 to Mar 1 is 1 month 1 day', () => {
  assert.deepEqual(breakdownYMD(d(2026, 1, 31), d(2026, 3, 1)), {
    years: 0,
    months: 1,
    days: 1,
  });
});

test('month-end clamping never goes negative', () => {
  // Jan 31 -> Feb 28: one clamped month, zero leftover days.
  assert.deepEqual(breakdownYMD(d(2026, 1, 31), d(2026, 2, 28)), {
    years: 0,
    months: 1,
    days: 0,
  });
  // Leap year: Jan 31 2024 -> Feb 29 2024.
  assert.deepEqual(breakdownYMD(d(2024, 1, 31), d(2024, 2, 29)), {
    years: 0,
    months: 1,
    days: 0,
  });
  // Oct 31 -> Nov 30.
  assert.deepEqual(breakdownYMD(d(2025, 10, 31), d(2025, 11, 30)), {
    years: 0,
    months: 1,
    days: 0,
  });
});

test('breakdown across years and reversed order', () => {
  assert.deepEqual(breakdownYMD(d(2020, 6, 15), d(2026, 6, 15)), {
    years: 6,
    months: 0,
    days: 0,
  });
  const fwd = breakdownYMD(d(2026, 1, 31), d(2026, 3, 1));
  const rev = breakdownYMD(d(2026, 3, 1), d(2026, 1, 31));
  assert.deepEqual(rev, fwd);
});

test('include today counts both ends, including the owner Until example', () => {
  // 22 Oct 2026 → 30 Jan 2027 is 100 midnights. Counting today makes it 101.
  const today = d(2026, 10, 22);
  const jan30 = d(2027, 1, 30);
  assert.equal(countedDays(today, jan30, false), 100);
  assert.equal(countedDays(today, jan30, true), 101);
  assert.equal(formatBreakdown(countedBreakdown(today, jan30, false)), '3 months 8 days');
  assert.equal(formatBreakdown(countedBreakdown(today, jan30, true)), '3 months 9 days');
  // Between counts the start date and the end date.
  assert.equal(countedDays(d(2026, 1, 1), d(2026, 1, 3), true), 3);
  assert.equal(countedDays(today, today, true), 1);
  assert.equal(countedDays(today, today, false), 0);
  assert.equal(formatBreakdown(countedBreakdown(today, today, true)), '1 day');
  // A past target stays negative and also includes both ends.
  assert.equal(countedDays(jan30, today, true), -101);
  assert.deepEqual(countedBreakdown(jan30, today, true), countedBreakdown(today, jan30, true));
});

test('include today stays exact across DST and leap years', () => {
  // Spring forward 2026-03-08 and fall back 2026-11-01. Times are not
  // midnight, so a raw millisecond divide would slip; the calendar count does not.
  const springBefore = new Date(2026, 2, 7, 23, 30);
  const springAfter = new Date(2026, 2, 9, 0, 30);
  assert.equal(daysBetween(springBefore, springAfter), 2);
  assert.equal(countedDays(springBefore, springAfter, true), 3);
  const fallBefore = new Date(2026, 10, 1, 1, 30);
  const fallAfter = new Date(2026, 10, 2, 1, 30);
  assert.equal(daysBetween(fallBefore, fallAfter), 1);
  assert.equal(countedDays(fallBefore, fallAfter, true), 2);
  assert.equal(formatBreakdown(countedBreakdown(fallBefore, fallAfter, false)), '1 day');
  assert.equal(formatBreakdown(countedBreakdown(fallBefore, fallAfter, true)), '2 days');
  // 2024 has Feb 29. 2025 does not.
  assert.equal(countedDays(d(2024, 2, 28), d(2024, 3, 1), false), 2);
  assert.equal(countedDays(d(2024, 2, 28), d(2024, 3, 1), true), 3);
  assert.equal(countedDays(d(2025, 2, 28), d(2025, 3, 1), false), 1);
  assert.equal(countedDays(d(2025, 2, 28), d(2025, 3, 1), true), 2);
  assert.equal(countedDays(d(2024, 2, 29), d(2025, 2, 28), true), 366);
});

test('formatBreakdown words', () => {
  assert.equal(
    formatBreakdown({ years: 1, months: 2, days: 3 }),
    '1 year 2 months 3 days',
  );
  assert.equal(formatBreakdown({ years: 0, months: 0, days: 1 }), '1 day');
  assert.equal(formatBreakdown({ years: 0, months: 0, days: 0 }), '0 days');
});
