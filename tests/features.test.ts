import assert from 'node:assert/strict';
import test from 'node:test';

import { checkLink } from '../src/lib/linkCheck.ts';
import { matchSnippet, setShortcut, shortcutProblem, addClip } from '../src/lib/clips.ts';
import {
  addCountdown,
  daysLeft,
  deleteCountdown,
  describeDaysLeft,
  nextCountdown,
  sortCountdowns,
} from '../src/lib/countdowns.ts';
import { buildPalette, encodeGif, planGif, quantizeWithPalette, quantizeFrame } from '../src/lib/gifenc.ts';
import type { AppState } from '../src/types.ts';

const empty: AppState = { clips: [], qrHistory: [], countdowns: [] };

// ---- QR link check --------------------------------------------------------

test('link check: ordinary https link is clean and shows its host', () => {
  const r = checkLink('https://www.example.com/menu?table=4');
  assert.equal(r.kind, 'url');
  assert.equal(r.host, 'www.example.com');
  assert.deepEqual(r.warnings, []);
  assert.equal(checkLink('https://www.bbc.co.uk/news').risky, false);
  assert.equal(checkLink('https://first.example.com').risky, false, 'no brand false positive');
});

test('link check: classic tricks are each flagged', () => {
  const cases: [string, RegExp][] = [
    ['http://example.com', /Not secure/],
    ['https://paypal.com@evil.example/login', /disguise/],
    ['https://192.168.4.20/pay', /IP address/],
    ['https://xn--pple-43d.com', /look-alike/],
    ['https://bit.ly/3abc', /Shortened/],
    ['https://prize.example.zip', /Unusual ending/],
    ['https://paypal.com.account-verify.example/x', /really account-verify\.example|really example/],
    ['https://apple.secure-id.example', /Looks like “apple”/],
    ['https://example.com:8443/', /unusual port/],
  ];
  for (const [url, re] of cases) {
    const r = checkLink(url);
    assert.ok(r.risky, url);
    assert.ok(r.warnings.some((w) => re.test(w)), `${url}: ${r.warnings.join(' | ')}`);
  }
});

test('link check: non-web payloads', () => {
  assert.equal(checkLink('mailto:a@b.co').kind, 'mailto');
  assert.equal(checkLink('tel:+15551234567').kind, 'tel');
  assert.equal(checkLink('javascript:alert(1)').risky, true);
  assert.equal(checkLink('WIFI:T:WPA;S:x;P:y;;').risky, false);
});

// ---- Snippets ----------------------------------------------------------------

test('snippets: set, validate, expand the word before the cursor', () => {
  let s = addClip(empty, '221B Baker Street, London', 1, 'a').state;
  s = addClip(s, 'ada@example.com', 2, 'b').state;
  assert.equal(shortcutProblem(s, 'a', 'a b'), 'Use 2–16 letters or numbers (no spaces).');
  s = setShortcut(s, 'a', ';Addr');
  assert.equal(s.clips.find((c) => c.id === 'a')?.shortcut, 'addr');
  assert.match(shortcutProblem(s, 'b', 'addr') ?? '', /already used/);
  assert.deepEqual(matchSnippet(s.clips, 'Ship it to addr'), { remove: 4, insert: '221B Baker Street, London' });
  assert.deepEqual(matchSnippet(s.clips, 'ADDR'), { remove: 4, insert: '221B Baker Street, London' });
  assert.equal(matchSnippet(s.clips, 'address'), null, 'only whole words');
  assert.equal(matchSnippet(s.clips, 'addr '), null, 'already followed by a space');
  s = setShortcut(s, 'a', '');
  assert.equal(s.clips.find((c) => c.id === 'a')?.shortcut, undefined);
  assert.equal(matchSnippet(s.clips, 'addr'), null);
});

// ---- Countdowns --------------------------------------------------------------

test('countdowns: soonest upcoming first, widget picks it, past later', () => {
  const today = new Date(2026, 9, 20);
  let s = addCountdown(empty, 'Trip', new Date(2026, 11, 1), 1, 'trip');
  s = addCountdown(s, 'Birthday', new Date(2026, 9, 25), 2, 'bday');
  s = addCountdown(s, 'Launch', new Date(2026, 8, 1), 3, 'old');
  assert.deepEqual(sortCountdowns(s.countdowns, today).map((c) => c.id), ['bday', 'trip', 'old']);
  assert.equal(nextCountdown(s.countdowns, today)?.id, 'bday');
  assert.equal(daysLeft(s.countdowns.find((c) => c.id === 'bday')!, today), 5);
  assert.equal(describeDaysLeft(0), 'Today');
  assert.equal(describeDaysLeft(1), 'Tomorrow');
  assert.equal(describeDaysLeft(-3), '3 days ago');
  s = deleteCountdown(s, 'bday');
  assert.equal(nextCountdown(s.countdowns, today)?.id, 'trip');
  assert.equal(nextCountdown(deleteCountdown(s, 'trip').countdowns, today), null);
  assert.equal(addCountdown(empty, '   ', today).countdowns[0]?.title, 'Countdown');
});

// ---- GIF colour --------------------------------------------------------------

function gradient(w: number, h: number, shift: number): Uint8Array {
  const f = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      f[i] = (x * 4 + shift) & 255;
      f[i + 1] = 90 + ((y * 3) & 63);
      f[i + 2] = 200 - ((x + y) & 127);
      f[i + 3] = 255;
    }
  return f;
}

function meanError(src: Uint8Array, idx: Uint8Array, pal: Uint8Array | number[]): number {
  let e = 0;
  for (let i = 0; i < idx.length; i += 1) {
    for (let c = 0; c < 3; c += 1) e += Math.abs(src[i * 4 + c]! - (pal[idx[i]! * 3 + c] as number));
  }
  return e / (idx.length * 3);
}

test('gif colour: adaptive palette is far closer than the fixed one', () => {
  const frames = [gradient(64, 48, 0), gradient(64, 48, 20)];
  const pal = buildPalette(frames);
  assert.equal(pal.length, 768);
  const adaptive = meanError(frames[0]!, quantizeWithPalette(frames[0]!, 64, pal, false), pal);
  const fixedPal: number[] = [];
  for (const r of [0, 51, 102, 153, 204, 255]) for (const g of [0, 51, 102, 153, 204, 255]) for (const b of [0, 51, 102, 153, 204, 255]) fixedPal.push(r, g, b);
  const fixed = meanError(frames[0]!, quantizeFrame(frames[0]!), fixedPal);
  assert.ok(adaptive < fixed / 2, `adaptive ${adaptive.toFixed(2)} vs fixed ${fixed.toFixed(2)}`);
});

test('gif colour: encoded GIF carries the adaptive palette', () => {
  const frames = [gradient(16, 16, 0)];
  const pal = buildPalette(frames, 256);
  const gif = encodeGif([quantizeWithPalette(frames[0]!, 16, pal)], 16, 16, 10, pal);
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
  assert.deepEqual(Array.from(gif.slice(13, 13 + 6)), Array.from(pal.slice(0, 6)));
  assert.equal(gif[gif.length - 1], 0x3b);
});


test('gif plan: start/length clamp to the clip, frame times at fps', () => {
  const p = planGif({ durationSec: 12, startSec: 3, lengthSec: 2, fps: 10 });
  assert.equal(p.times.length, 20);
  assert.equal(p.times[0], 3000);
  assert.equal(p.times[19], 4900);
  const tail = planGif({ durationSec: 4, startSec: 3, lengthSec: 10, fps: 6 });
  assert.ok(tail.times.every((t) => t < 4000), 'never past the end');
  assert.equal(planGif({ durationSec: 60, lengthSec: 30, fps: 8 }).times.length, 80, 'max 10 s');
  assert.equal(planGif({ durationSec: 0 }).times.length, 40, 'unknown length → 5 s at 8 fps');
});
