import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePageSpec, specToIndices } from '../src/lib/pages.ts';
import { contactPayload, wifiPayload } from '../src/lib/qrpayload.ts';
import {
  scaledHeight,
  STITCH_MAX_WIDTH,
  stitchWidth,
} from '../src/lib/stitchMath.ts';

test('page spec: 1-based pages, ranges, dedupe, clamp', () => {
  assert.deepEqual(parsePageSpec('3', 10), [3]);
  assert.deepEqual(parsePageSpec('1-3,5', 10), [1, 2, 3, 5]);
  assert.deepEqual(parsePageSpec('5,1-2,2,99', 6), [1, 2, 5]);
  assert.deepEqual(parsePageSpec('9-12', 10), [9, 10]);
  assert.deepEqual(parsePageSpec(' , ', 10), []);
  assert.deepEqual(specToIndices('1-2,4', 10), [0, 1, 3]);
});

test('stitch width: narrowest shot, capped at phone width', () => {
  assert.equal(
    stitchWidth([
      { width: 4284, height: 5712 },
      { width: 4284, height: 5712 },
    ]),
    STITCH_MAX_WIDTH,
  );
  assert.equal(stitchWidth([{ width: 828, height: 1792 }, { width: 1170, height: 2532 }]), 828);
  assert.equal(stitchWidth([]), 0);
  // unknown sizes (0) from the share sheet don't collapse the width
  assert.equal(stitchWidth([{ width: 0, height: 0 }, { width: 1170, height: 2532 }]), 1170);
});

test('scaled height keeps aspect', () => {
  assert.equal(scaledHeight({ width: 2340, height: 5064 }, 1170), 2532);
  assert.equal(scaledHeight({ width: 0, height: 10 }, 1170), 0);
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
