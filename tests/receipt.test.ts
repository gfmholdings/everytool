import assert from 'node:assert/strict';
import test from 'node:test';

import { linesFromBoxes, parseReceipt, prorate, splitByItems } from '../src/lib/receipt.ts';

test('receipt: OCR boxes on one printed line are joined left to right', () => {
  const lines = linesFromBoxes([
    { text: '12.50', x: 0.8, y: 0.301, width: 0.1, height: 0.02 },
    { text: 'Burger', x: 0.1, y: 0.3, width: 0.2, height: 0.02 },
    { text: 'Fries', x: 0.1, y: 0.33, width: 0.2, height: 0.02 },
    { text: '4.00', x: 0.8, y: 0.332, width: 0.1, height: 0.02 },
  ]);
  assert.deepEqual(lines, ['Burger 12.50', 'Fries 4.00']);
});

test('receipt: items, subtotal, tax, total; payment lines ignored', () => {
  const r = parseReceipt([
    'THE CORNER CAFE',
    '123 Main St  Tel 555-0100',
    '2 x Burger        25.00',
    'Fries              4.50',
    'Iced Tea           3.25 T',
    'Discount          -2.00',
    'Subtotal          30.75',
    'Sales Tax          2.46',
    'TOTAL             33.21',
    'VISA ****1234     33.21',
    'Change             0.00',
  ]);
  assert.deepEqual(r.items.map((i) => [i.name, i.cents]), [
    ['2 x Burger', 2500],
    ['Fries', 450],
    ['Iced Tea', 325],
    ['Discount', -200],
  ]);
  assert.equal(r.subtotalCents, 3075);
  assert.equal(r.taxCents, 246);
  assert.equal(r.totalCents, 3321);
});

test('receipt: comma decimals and thousands', () => {
  const r = parseReceipt(['Laptop 1,299.00', 'Bag 49,90', 'Total 1.348,90']);
  assert.deepEqual(r.items.map((i) => i.cents), [129900, 4990]);
});

test('prorate deals every cent exactly', () => {
  assert.deepEqual(prorate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(prorate(10, [3, 1]), [8, 2]);
  assert.equal(prorate(999, [5, 7, 11]).reduce((a, b) => a + b, 0), 999);
  assert.deepEqual(prorate(5, [0, 0]), [3, 2]);
});

test('split by item: shared and individual items, tax and tip follow shares', () => {
  const items = [
    { name: 'Burger', cents: 1200 }, // Ann
    { name: 'Salad', cents: 900 }, // Ben
    { name: 'Nachos', cents: 1000 }, // shared by all three
  ];
  const s = splitByItems(items, [[0], [1], []], 3, 310, { percent: 20 });
  assert.equal(s.itemsCents, 3100);
  assert.equal(s.tipCents, 620);
  assert.equal(s.grandCents, 3100 + 310 + 620);
  assert.equal(s.perPerson.reduce((a, b) => a + b, 0), s.grandCents);
  // Ann ate the most, Cee only shared nachos
  assert.ok(s.perPerson[0]! > s.perPerson[1]! && s.perPerson[1]! > s.perPerson[2]!);
  // Nachos 1000 split 334/333/333 (first person gets the odd cent); Cee
  // pays 333 + her proportional share of tax and tip, within a cent each.
  const exact = 333 + (310 * 333) / 3100 + (620 * 333) / 3100;
  assert.ok(Math.abs(s.perPerson[2]! - exact) <= 2, `${s.perPerson[2]} vs ${exact}`);
});

test('split by item: fixed tip and out-of-range people are safe', () => {
  const s = splitByItems([{ name: 'A', cents: 1001 }], [[0, 1, 7]], 2, 0, { cents: 99 });
  assert.equal(s.grandCents, 1100);
  assert.deepEqual(s.perPerson, [551, 549]);
});
