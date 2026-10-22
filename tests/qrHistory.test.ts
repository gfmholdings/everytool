import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeStates } from '../src/lib/clips.ts';
import {
  DEFAULT_QR_STYLE,
  deleteQrHistoryItem,
  formatQrDate,
  MAX_QR_HISTORY,
  mergeQrHistory,
  normalizeQrHistory,
  qrContentPreview,
  saveQrHistory,
} from '../src/lib/qrHistory.ts';
import type { QrHistoryItem } from '../src/types.ts';

const wifi = 'WIFI:T:WPA;S:Cafe\\;Name;P:secret;;';

test('qr history: save keeps content, type, style, and date, newest first', () => {
  const first = saveQrHistory([], { direction: 'made', payload: 'hello' }, 1_000, 'a');
  const second = saveQrHistory(
    first.items,
    {
      direction: 'made',
      payload: 'https://example.com/everytool',
      style: { foreground: '#112233', background: '#FFFFFF' },
    },
    2_000,
    'b',
  );
  assert.deepEqual(
    second.items.map((q) => q.id),
    ['b', 'a'],
  );
  const url = second.items[0]!;
  assert.equal(url.payload, 'https://example.com/everytool');
  assert.equal(url.type, 'url');
  assert.equal(url.kind, 'URL');
  assert.equal(url.direction, 'made');
  assert.deepEqual(url.style, { foreground: '#112233', background: '#FFFFFF' });
  assert.equal(url.createdAt, 2_000);
  assert.equal(second.items[1]!.type, 'text');
  assert.deepEqual(second.items[1]!.style, DEFAULT_QR_STYLE);
  assert.equal(saveQrHistory(second.items, { direction: 'made', payload: '   ' }, 3).item, null);
});

test('qr history: regenerating identical content moves it to the top', () => {
  let items = saveQrHistory([], { direction: 'made', payload: 'hello' }, 1, 'a').items;
  items = saveQrHistory(items, { direction: 'made', payload: wifi }, 2, 'b').items;
  const again = saveQrHistory(
    items,
    { direction: 'made', payload: 'hello', style: { foreground: '#00AA00' } },
    3,
    'c',
  );
  assert.equal(again.items.length, 2);
  assert.equal(again.item?.id, 'a');
  assert.equal(again.items[0]!.id, 'a');
  assert.equal(again.items[0]!.createdAt, 3);
  assert.equal(again.items[0]!.style.foreground, '#00AA00');
  assert.equal(again.items[1]!.id, 'b');
  assert.equal(qrContentPreview(wifi), 'Cafe;Name');
});

test('qr history: a scan of the same text does not replace the made code', () => {
  const made = saveQrHistory([], { direction: 'made', payload: 'hello' }, 1, 'a').items;
  const both = saveQrHistory(made, { direction: 'scanned', payload: 'hello' }, 2, 'b');
  assert.deepEqual(
    both.items.map((q) => q.direction),
    ['scanned', 'made'],
  );
});

test('qr history: delete removes one code and clear removes the list', () => {
  let items = saveQrHistory([], { direction: 'made', payload: 'one' }, 1, 'a').items;
  items = saveQrHistory(items, { direction: 'made', payload: 'two' }, 2, 'b').items;
  items = deleteQrHistoryItem(items, 'a');
  assert.deepEqual(
    items.map((q) => q.id),
    ['b'],
  );
  assert.deepEqual(deleteQrHistoryItem(items, 'missing'), items);
  assert.deepEqual(deleteQrHistoryItem(items, 'b'), []);
});

test('qr history: the cap keeps the newest 100 and drops the oldest', () => {
  let items: QrHistoryItem[] = [];
  for (let i = 1; i <= MAX_QR_HISTORY; i += 1) {
    items = saveQrHistory(items, { direction: 'made', payload: `p${i}` }, i, `id${i}`).items;
  }
  assert.equal(items.length, MAX_QR_HISTORY);
  assert.equal(items[0]!.id, `id${MAX_QR_HISTORY}`);
  assert.equal(items.at(-1)!.id, 'id1');

  const bumped = saveQrHistory(items, { direction: 'made', payload: 'p1' }, 10_000, 'new');
  assert.equal(bumped.items.length, MAX_QR_HISTORY);
  assert.equal(bumped.item?.id, 'id1');
  assert.equal(bumped.items[0]!.id, 'id1');
  assert.ok(bumped.items.some((q) => q.id === `id${MAX_QR_HISTORY}`));
  assert.equal(bumped.items.filter((q) => q.payload === 'p1').length, 1);

  const extra = saveQrHistory(items, { direction: 'made', payload: 'fresh' }, 10_000, 'fresh');
  assert.equal(extra.items.length, MAX_QR_HISTORY);
  assert.equal(extra.items[0]!.id, 'fresh');
  assert.equal(
    extra.items.some((q) => q.id === 'id1'),
    false,
  );
});

test('qr history: merging two on-device copies keeps the newer code', () => {
  const older = saveQrHistory(
    [],
    { direction: 'made', payload: 'hello', style: { foreground: '#111111' } },
    1,
    'old',
  ).item!;
  const newer = saveQrHistory(
    [],
    { direction: 'made', payload: 'hello', style: { foreground: '#222222' } },
    5,
    'new',
  ).item!;
  const other = saveQrHistory([], { direction: 'made', payload: 'other' }, 3, 'o').item!;
  const primary = { clips: [], countdowns: [], qrHistory: [older, other] };
  const extra = { clips: [], countdowns: [], qrHistory: [newer] };
  const merged = mergeQrHistory(primary.qrHistory, extra.qrHistory);
  assert.deepEqual(mergeStates(primary, extra).qrHistory, merged);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.id, 'new');
  assert.equal(merged[0]!.style.foreground, '#222222');
  assert.ok(merged.some((q) => q.id === 'o'));

  const many: QrHistoryItem[] = [];
  for (let i = 0; i < MAX_QR_HISTORY + 5; i += 1) {
    const item = saveQrHistory([], { direction: 'made', payload: `m${i}` }, i, `m${i}`).item;
    if (item) many.push(item);
  }
  const capped = mergeQrHistory(many, []);
  assert.equal(capped.length, MAX_QR_HISTORY);
  assert.equal(capped[0]!.id, `m${MAX_QR_HISTORY + 4}`);
  assert.deepEqual(
    mergeStates(
      { clips: [], countdowns: [], qrHistory: many },
      { clips: [], countdowns: [], qrHistory: [] },
    ).qrHistory,
    capped,
  );
});

test('qr history: old rows gain a type and style, junk is dropped', () => {
  const items = normalizeQrHistory([
    { id: 'old', direction: 'made', kind: 'Link', payload: 'https://example.com', createdAt: 5 },
    { id: '', payload: 'nope' },
    null,
    { id: 'blank', payload: '   ', createdAt: 1 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.type, 'url');
  assert.deepEqual(items[0]!.style, DEFAULT_QR_STYLE);
  assert.equal(formatQrDate(new Date(2026, 9, 22, 15).getTime()), 'Oct 22, 2026');
});
