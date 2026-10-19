import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePageSpec, specToIndices } from '../src/lib/pages.ts';
import { contactPayload, wifiPayload } from '../src/lib/qrpayload.ts';
import {
  planStitch,
  STITCH_MAX_HEIGHT,
  STITCH_MAX_WIDTH,
} from '../src/lib/stitchMath.ts';

test('page spec: 1-based pages, ranges, dedupe, clamp', () => {
  assert.deepEqual(parsePageSpec('3', 10), [3]);
  assert.deepEqual(parsePageSpec('1-3,5', 10), [1, 2, 3, 5]);
  assert.deepEqual(parsePageSpec('5,1-2,2,99', 6), [1, 2, 5]);
  assert.deepEqual(parsePageSpec('9-12', 10), [9, 10]);
  assert.deepEqual(parsePageSpec(' , ', 10), []);
  assert.deepEqual(specToIndices('1-2,4', 10), [0, 1, 3]);
});

test('stitch plan: working width is the narrowest shot, capped', () => {
  const plan = planStitch(
    [
      { width: 4284, height: 5712 },
      { width: 4284, height: 5712 },
    ],
    [0],
  );
  assert.equal(plan.width, STITCH_MAX_WIDTH);
  assert.equal(plan.outWidth, STITCH_MAX_WIDTH);
});

test('stitch plan: output height is capped and the strip shrinks', () => {
  const shots = Array.from({ length: 10 }, () => ({
    width: 1170,
    height: 2532,
  }));
  const plan = planStitch(shots, Array(9).fill(0));
  assert.equal(plan.height, STITCH_MAX_HEIGHT);
  assert.equal(plan.capped, true);
  assert.ok(plan.outWidth < plan.width);
});

test('stitch plan: overlap is subtracted, missing overlap stacks', () => {
  const plan = planStitch(
    [
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
    ],
    [250, 0],
  );
  assert.equal(plan.naturalHeight, 1000 + 750 + 1000);
  assert.deepEqual(plan.offsetsY, [0, 750, 1750]);
  assert.equal(plan.stacked, true); // second seam had no overlap
  assert.equal(plan.capped, false);
});

test('stitch plan: empty input is a zero plan', () => {
  const plan = planStitch([], []);
  assert.equal(plan.height, 0);
  assert.equal(plan.width, 0);
});

test('wifi payload escapes specials; open nets carry no password', () => {
  assert.equal(
    wifiPayload('Home;Net', 'p:ss', 'WPA'),
    'WIFI:T:WPA;S:Home\\;Net;P:p\\:ss;;',
  );
  assert.equal(wifiPayload('Cafe', '', 'nopass'), 'WIFI:T:nopass;S:Cafe;;');
});

test('contact payload is a vCard', () => {
  const v = contactPayload({
    name: 'Ana Lee',
    phone: '2125550134',
    email: 'ana@example.com',
    org: 'GFM',
  });
  assert.ok(v.startsWith('BEGIN:VCARD\nVERSION:3.0\nFN:Ana Lee'));
  assert.ok(v.includes('TEL;TYPE=CELL:2125550134'));
  assert.ok(v.endsWith('END:VCARD'));
});
