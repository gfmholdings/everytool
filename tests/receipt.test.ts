import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  linesFromBoxes,
  mergeParsedReceipts,
  parseReceipt,
  parseReceiptBoxes,
  prorate,
  splitByItems,
  type TextBox,
} from '../src/lib/receipt.ts';

function box(text: string, x: number, y: number, width = 0.16, height = 0.02): TextBox {
  return { text, x, y, width, height };
}

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

test('sample OCR: a cafe receipt, prices on the right edge of each row', () => {
  // What Vision returns after the document camera crops the page:
  // the item, a unit price, the line price, and a tax flag past the amount.
  const page = [
    box('CAFE LUNA', 0.28, 0.04, 0.4),
    box('2 x', 0.06, 0.16, 0.08),
    box('Burger', 0.16, 0.16, 0.2),
    box('6.25', 0.52, 0.161, 0.1),
    box('12.50', 0.76, 0.16, 0.14),
    box('Fries', 0.06, 0.21, 0.14),
    box('4.00', 0.76, 0.211, 0.14),
    box('Iced Tea', 0.06, 0.26, 0.2),
    box('3.25', 0.7, 0.26, 0.12),
    box('T', 0.86, 0.26, 0.04),
    box('Subtotal', 0.06, 0.34, 0.22),
    box('19.75', 0.76, 0.34, 0.14),
    box('Sales Tax', 0.06, 0.39, 0.22),
    box('1.58', 0.76, 0.39, 0.14),
    box('Tip', 0.06, 0.44, 0.1),
    box('3.00', 0.76, 0.44, 0.14),
    box('Total', 0.06, 0.5, 0.14),
    box('24.33', 0.76, 0.5, 0.14),
    box('VISA', 0.06, 0.58, 0.12),
    box('24.33', 0.76, 0.58, 0.14),
    box('Thank you', 0.3, 0.7, 0.3),
  ];
  const parsed = parseReceiptBoxes(page);
  assert.deepEqual(parsed.items.map((item) => [item.name, item.cents]), [
    ['2 x Burger', 1250],
    ['Fries', 400],
    ['Iced Tea', 325],
  ]);
  assert.equal(parsed.subtotalCents, 1975);
  assert.equal(parsed.taxCents, 158);
  assert.equal(parsed.tipCents, 300);
  assert.equal(parsed.totalCents, 2433);
  const itemsSum = parsed.items.reduce((sum, item) => sum + item.cents, 0);
  assert.equal(itemsSum + (parsed.taxCents ?? 0) + (parsed.tipCents ?? 0), parsed.totalCents);
});

test('sample OCR: a comma decimal stays the line price', () => {
  const parsed = parseReceiptBoxes([
    box('Bag', 0.08, 0.22, 0.18),
    box('49,90', 0.72, 0.22, 0.16),
  ]);
  assert.deepEqual(parsed.items, [{ name: 'Bag', cents: 4990 }]);
});

test('sample OCR: a word to the right of the price is not the price', () => {
  const parsed = parseReceiptBoxes([
    box('Pasta', 0.08, 0.3, 0.2),
    box('14.00', 0.62, 0.3, 0.12),
    box('SERVER', 0.84, 0.302, 0.14),
  ]);
  assert.deepEqual(parsed.items, [{ name: 'Pasta', cents: 1400 }]);
});

test('sample OCR: a second page adds its items and keeps the final total', () => {
  const food = parseReceiptBoxes([
    box('Soup', 0.08, 0.2, 0.16),
    box('8.00', 0.76, 0.2, 0.14),
    box('Tax', 0.08, 0.3, 0.12),
    box('0.64', 0.76, 0.3, 0.14),
  ]);
  const drinks = parseReceiptBoxes([
    box('Wine', 0.08, 0.2, 0.16),
    box('11.00', 0.76, 0.2, 0.14),
    box('Tax', 0.08, 0.3, 0.12),
    box('0.88', 0.76, 0.3, 0.14),
    box('Gratuity', 0.08, 0.36, 0.2),
    box('2.00', 0.76, 0.36, 0.14),
    box('Amount due', 0.08, 0.44, 0.28),
    box('22.52', 0.7, 0.44, 0.18),
  ]);
  const merged = mergeParsedReceipts([food, drinks]);
  assert.deepEqual(merged.items.map((item) => item.name), ['Soup', 'Wine']);
  assert.equal(merged.taxCents, 64 + 88);
  assert.equal(merged.tipCents, 200);
  assert.equal(merged.totalCents, 2252);
});

test('receipt scanner is VisionKit capture plus accurate Vision OCR', () => {
  const src = readFileSync(
    new URL('../modules/shared-vault/ios/EverytoolSharedVaultModule.swift', import.meta.url),
    'utf8',
  );
  assert.match(src, /VNDocumentCameraViewController/);
  assert.match(src, /recognitionLevel = \.accurate/);
  assert.match(src, /usesLanguageCorrection = true/);
  assert.match(src, /VNRecognizeTextRequest\.currentRevision/);
  assert.match(src, /DataScannerViewController/);
});

test('split by item: fixed tip and out-of-range people are safe', () => {
  const s = splitByItems([{ name: 'A', cents: 1001 }], [[0, 1, 7]], 2, 0, { cents: 99 });
  assert.equal(s.grandCents, 1100);
  assert.deepEqual(s.perPerson, [551, 549]);
});
