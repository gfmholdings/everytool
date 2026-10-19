import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMoney, splitBill } from '../src/lib/money.ts';

test('split sums exactly to the grand total', () => {
  const r = splitBill(100, 8.5, 18, 3);
  assert.equal(r.grandCents, 10000 + 850 + 1800);
  assert.equal(
    r.sharesCents.reduce((a, b) => a + b, 0),
    r.grandCents,
  );
  assert.equal(r.sharesCents.length, 3);
});

test('uneven cents are dealt one at a time, never lost', () => {
  const r = splitBill(10, 0, 0, 3); // 1000 cents / 3 = 333.33…
  assert.deepEqual(r.sharesCents, [334, 333, 333]);
  const r2 = splitBill(0.01, 0, 0, 2);
  assert.deepEqual(r2.sharesCents, [1, 0]);
});

test('tip applies to the subtotal only, tax adds on top', () => {
  const r = splitBill(50, 4, 20, 2);
  assert.equal(r.tipCents, 1000);
  assert.equal(r.grandCents, 5000 + 400 + 1000);
  assert.deepEqual(r.sharesCents, [3200, 3200]);
});

test('rounding: half cents round to nearest, shares still exact', () => {
  const r = splitBill(33.33, 2.67, 15, 4);
  assert.equal(r.tipCents, 500); // 3333 * 0.15 = 499.95 → 500
  assert.equal(
    r.sharesCents.reduce((a, b) => a + b, 0),
    r.grandCents,
  );
});

test('degenerate inputs stay safe', () => {
  const zero = splitBill(0, 0, 0, 4);
  assert.equal(zero.grandCents, 0);
  assert.deepEqual(zero.sharesCents, [0, 0, 0, 0]);
  const one = splitBill(20, 0, 10, 1);
  assert.deepEqual(one.sharesCents, [2200]);
});

test('formatMoney', () => {
  assert.equal(formatMoney(1234), '$12.34');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(100050), '$1,000.50');
});
