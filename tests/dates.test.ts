import assert from 'node:assert/strict';
import test from 'node:test';

import { breakdownYMD, daysBetween, formatBreakdown } from '../src/lib/dates.ts';

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

test('formatBreakdown words', () => {
  assert.equal(
    formatBreakdown({ years: 1, months: 2, days: 3 }),
    '1 year 2 months 3 days',
  );
  assert.equal(formatBreakdown({ years: 0, months: 0, days: 1 }), '1 day');
  assert.equal(formatBreakdown({ years: 0, months: 0, days: 0 }), '0 days');
});
