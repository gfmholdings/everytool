import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodePngRows } from '../src/lib/deflate.ts';
import {
  clampGifRange,
  estimateGifBytes,
  formatGifTime,
  gifDelayCs,
  gifFromRgba,
  planGif,
} from '../src/lib/gifenc.ts';

function gradient(w: number, h: number, shift: number): Uint8Array {
  const f = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      f[i] = (x * 8 + shift) & 255;
      f[i + 1] = 40 + ((y * 5) & 127);
      f[i + 2] = 220 - ((x + y + shift) & 63);
      f[i + 3] = 255;
    }
  }
  return f;
}

function findAscii(bytes: Uint8Array, text: string): number {
  const needle = Array.from(text).map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

test('owner clip: 18 s, start 10, length 5, 10 fps is 50 frames a tenth apart', () => {
  const p = planGif({ durationSec: 18, startSec: 10, lengthSec: 5, fps: 10 });
  assert.equal(p.times.length, 50);
  assert.equal(p.times[0], 10000);
  assert.equal(p.times[49], 14900);
  assert.equal(p.lengthSec, 5);
  const gaps = p.times.slice(1).map((t, i) => t - p.times[i]!);
  assert.ok(gaps.every((g) => g === 100));
  assert.equal(gifDelayCs(p.times, p.fps), 10);
});

test('range clamps to 0.5 s minimum and 10 s maximum', () => {
  const tiny = clampGifRange({
    durationSec: 18,
    startSec: 10,
    endSec: 10.1,
    anchor: 'start',
  });
  assert.equal(tiny.startSec, 10);
  assert.equal(tiny.endSec, 10.5);
  assert.equal(tiny.lengthSec, 0.5);

  const huge = clampGifRange({
    durationSec: 40,
    startSec: 2,
    endSec: 30,
    anchor: 'start',
  });
  assert.equal(huge.startSec, 2);
  assert.equal(huge.endSec, 12);
  assert.equal(huge.lengthSec, 10);

  const draggedStart = clampGifRange({
    durationSec: 40,
    startSec: 0,
    endSec: 20,
    anchor: 'end',
  });
  assert.equal(draggedStart.endSec, 20);
  assert.equal(draggedStart.startSec, 10);
  assert.equal(draggedStart.lengthSec, 10);

  const slide = clampGifRange({
    durationSec: 18,
    startSec: 16,
    endSec: 21,
    anchor: 'window',
  });
  assert.equal(slide.lengthSec, 5);
  assert.equal(slide.endSec, 18);
  assert.equal(slide.startSec, 13);
});

test('a short tail never samples past the end of the clip', () => {
  const tail = planGif({ durationSec: 4, startSec: 3, lengthSec: 10, fps: 6 });
  assert.ok(tail.times.every((t) => t < 4000));
  assert.ok(tail.endSec <= 4);
  const nearEnd = planGif({ durationSec: 18, startSec: 17.9, lengthSec: 5, fps: 10 });
  assert.equal(nearEnd.lengthSec, 0.5);
  assert.ok(nearEnd.times.every((t) => t < 18000));
  assert.ok(nearEnd.times[0]! >= 17500);
});

test('a clip shorter than 0.5 s keeps the whole clip', () => {
  const short = clampGifRange({ durationSec: 0.3, startSec: 0, endSec: 5, anchor: 'start' });
  assert.equal(short.lengthSec, 0.3);
  assert.equal(short.startSec, 0);
  assert.equal(short.endSec, 0.3);
  const plan = planGif({ durationSec: 0.3, lengthSec: 10, fps: 8 });
  assert.ok(plan.times.every((t) => t < 300));
});

test('output timing follows the chosen fps, not a 60 fps source', () => {
  // The sampler is asked for these timestamps with zero tolerance.
  // A 60 fps source does not change the spacing: 10 fps stays 100 ms.
  const plan = planGif({ durationSec: 18, startSec: 10, lengthSec: 5, fps: 10 });
  const gaps = plan.times.slice(1).map((t, i) => t - plan.times[i]!);
  assert.ok(gaps.every((g) => g === 100));
  const capped = planGif({ durationSec: 2, fps: 60 });
  assert.equal(capped.fps, 15);
  const fastGaps = capped.times.slice(1).map((t, i) => t - capped.times[i]!);
  assert.ok(fastGaps.every((g) => g === 66 || g === 67));
});

test('time labels and the size estimate', () => {
  assert.equal(formatGifTime(10), '0:10.0');
  assert.equal(formatGifTime(65.44), '1:05.4');
  assert.equal(formatGifTime(0), '0:00.0');
  const best = estimateGifBytes({ width: 360, height: 640, frames: 50, colour: 'best' });
  const fast = estimateGifBytes({ width: 360, height: 640, frames: 50, colour: 'fast' });
  assert.ok(best > fast);
  assert.ok(best > 1000);
});

test('rgba frames encode to a looping GIF in Best and Fast, with no PNG', () => {
  const w = 16;
  const h = 12;
  const frames = [gradient(w, h, 0), gradient(w, h, 30)];
  for (const colour of ['fast', 'best'] as const) {
    const gif = gifFromRgba(frames, w, h, 10, colour);
    assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
    assert.equal(gif[gif.length - 1], 0x3b);
    const netscape = findAscii(gif, 'NETSCAPE2.0');
    assert.ok(netscape > 0);
    assert.deepEqual(Array.from(gif.slice(netscape + 11, netscape + 16)), [3, 1, 0, 0, 0]);
    const frame = gif.indexOf(0xf9, netscape);
    assert.equal(gif[frame - 1], 0x21);
    assert.equal(gif[frame + 3], 10);
    assert.equal(gif[frame + 4], 0);
    let controls = 0;
    for (let i = 0; i < gif.length - 1; i += 1) {
      if (gif[i] === 0x21 && gif[i + 1] === 0xf9) controls += 1;
    }
    assert.equal(controls, 2);
  }
  const best = gifFromRgba(frames, w, h, 10, 'best');
  const fast = gifFromRgba(frames, w, h, 10, 'fast');
  assert.notDeepEqual(Array.from(best.slice(13, 13 + 24)), Array.from(fast.slice(13, 13 + 24)));
  assert.deepEqual(Array.from(fast.slice(13, 13 + 6)), [0, 0, 0, 0, 0, 51]);
});

test('the PNG decoder still rejects the 16-bit stills that broke Make GIF', () => {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [
    0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 16, 2, 0, 0, 0, 0, 0, 0, 0,
  ];
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0];
  const png = Uint8Array.from([...sig, ...ihdr, ...iend]);
  assert.throws(() => decodePngRows(png, () => {}), /Unsupported PNG format\./);
});

test('the GIF pipeline source does not decode PNG frames', () => {
  const src = readFileSync(new URL('../src/lib/gif.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('decodePngRows'), false);
  assert.equal(src.includes('sampleVideoFrames'), true);
  assert.equal(src.includes('SaveFormat'), false);
});
