import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSessionShots, type PhotoMeta } from '../src/lib/sessionPick.ts';

const shot = (id: string, t: number, w = 1179, h = 2556, sub: string[] | undefined = ['screenshot']): PhotoMeta => ({
  id,
  creationTime: t,
  width: w,
  height: h,
  mediaSubtypes: sub,
});

test('session: only screenshots taken after Start, oldest first', () => {
  const start = 10_000;
  const picked = selectSessionShots(
    [
      shot('c', 13_000),
      shot('old', 5_000),
      shot('a', 11_000),
      shot('camera', 12_000, 3024, 4032, []),
      shot('b', 12_500),
    ],
    start,
  );
  assert.deepEqual(picked.map((p) => p.id), ['a', 'b', 'c']);
});

test('session: a screenshot taken a moment before Start registers (grace)', () => {
  assert.deepEqual(selectSessionShots([shot('x', 9_200)], 10_000).map((p) => p.id), ['x']);
});

test('session: odd sizes (landscape, another device) are left out', () => {
  const picked = selectSessionShots(
    [
      shot('a', 11_000),
      shot('landscape', 11_500, 2556, 1179),
      shot('ipad', 11_700, 2048, 2732),
      shot('b', 12_000),
    ],
    10_000,
  );
  assert.deepEqual(picked.map((p) => p.id), ['a', 'b']);
});

test('session: unknown subtypes (platform did not report) are kept', () => {
  const picked = selectSessionShots([shot('a', 11_000, 1179, 2556, undefined)], 10_000);
  assert.equal(picked.length, 1);
});

test('session: duplicates by id are dropped, nothing yields empty', () => {
  assert.equal(selectSessionShots([shot('a', 11_000), shot('a', 11_000)], 10_000).length, 1);
  assert.deepEqual(selectSessionShots([], 10_000), []);
});
