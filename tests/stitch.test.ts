import assert from 'node:assert/strict';
import test from 'node:test';

import { decodePngRows, PngStreamWriter } from '../src/lib/deflate.ts';
import {
  analyzeFrames,
  emitSegments,
  FeatureBuilder,
  PixelateSink,
  type FrameFeatures,
} from '../src/lib/stitchCore.ts';

// ---------------------------------------------------------------------------
// A synthetic phone screen: W wide, H tall, showing a long page scrolled to
// `scroll`. Fixed chrome: a status bar whose "clock" changes every frame,
// a nav bar, a tab bar, and a scroll indicator at the right edge that
// moves with the scroll — the things that break naive stitchers.
// ---------------------------------------------------------------------------

const W = 240;
const H = 520;
const STATUS = 30;
const NAV = 50;
const TAB = 60;
const PAGE_H = 6000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The page: paragraphs of "text" blocks on white with some blank gaps. */
function makePage(): Uint8Array {
  const page = new Uint8Array(W * PAGE_H * 4).fill(255);
  const r = rng(7);
  let y = 10;
  while (y < PAGE_H - 40) {
    const lines = 2 + Math.floor(r() * 6);
    for (let l = 0; l < lines && y < PAGE_H - 20; l += 1) {
      let x = 12;
      while (x < W - 30) {
        const word = 8 + Math.floor(r() * 30);
        const shade = 20 + Math.floor(r() * 90);
        for (let yy = y; yy < y + 11; yy += 1) {
          for (let xx = x; xx < Math.min(W - 24, x + word); xx += 1) {
            const i = (yy * W + xx) * 4;
            page[i] = shade;
            page[i + 1] = shade;
            page[i + 2] = shade + 20;
          }
        }
        x += word + 6;
      }
      y += 17;
    }
    y += 14 + Math.floor(r() * 30);
    if (r() < 0.25) {
      // an "image" block
      const hh = 60 + Math.floor(r() * 80);
      for (let yy = y; yy < Math.min(PAGE_H, y + hh); yy += 1) {
        for (let xx = 12; xx < W - 24; xx += 1) {
          const i = (yy * W + xx) * 4;
          page[i] = (xx * 3 + yy) & 255;
          page[i + 1] = (yy * 2) & 255;
          page[i + 2] = 128;
        }
      }
      y += hh + 16;
    }
  }
  return page;
}

const PAGE = makePage();
const CONTENT_TOP = STATUS + NAV;
const CONTENT_H = H - CONTENT_TOP - TAB;

const FLOAT_SIZE = 36;
const FLOAT_X = W - 10 - FLOAT_SIZE;
const FLOAT_Y = H - TAB - 14 - FLOAT_SIZE;
const FLOAT = { r: 255, g: 0, b: 200 };

function screen(scroll: number, clock: number, overlay = false, floating = false): Uint8Array {
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      if (y < STATUS) {
        // status bar; the "clock" digits change per frame
        const digit = x > 20 && x < 60 && y > 8 && y < 22;
        const v = digit ? ((clock * 37 + x * 5) & 255) : 245;
        r = v;
        g = v;
        b = v;
      } else if (y < CONTENT_TOP) {
        r = 30;
        g = 90;
        b = 200 + ((x >> 3) & 15);
      } else if (y >= H - TAB) {
        r = 235;
        g = 235;
        b = 240 - ((x >> 4) & 7) * 3;
        if (y > H - TAB + 15 && y < H - TAB + 40 && (x % 60) < 30) {
          r = 120;
          g = 120;
          b = 125;
        }
      } else {
        const py = scroll + (y - CONTENT_TOP);
        const pi = (py * W + x) * 4;
        r = PAGE[pi]!;
        g = PAGE[pi + 1]!;
        b = PAGE[pi + 2]!;
        // scroll indicator: a dark pill at the right edge that moves
        const pos = CONTENT_TOP + Math.round((scroll / (PAGE_H - CONTENT_H)) * (CONTENT_H - 60));
        if (x >= W - 6 && x < W - 2 && y >= pos && y < pos + 60) {
          r = 80;
          g = 80;
          b = 80;
        }
        // A compose button: fixed in screen space, only on the right,
        // so the rest of its rows keep scrolling. Sits in the band the
        // scroll matcher ignores (past 92% of the width) as well as just
        // inside it — the real Mail button does the same.
        if (
          floating &&
          x >= FLOAT_X &&
          x < FLOAT_X + FLOAT_SIZE &&
          y >= FLOAT_Y &&
          y < FLOAT_Y + FLOAT_SIZE
        ) {
          r = FLOAT.r;
          g = FLOAT.g;
          b = FLOAT.b;
        }
      }
      if (overlay) {
        // Control Center: everything dimmed and tinted
        r = (r * 0.3 + 40) | 0;
        g = (g * 0.3 + 40) | 0;
        b = (b * 0.3 + 60) | 0;
      }
      img[i] = r;
      img[i + 1] = g;
      img[i + 2] = b;
      img[i + 3] = 255;
    }
  }
  return img;
}

function features(img: Uint8Array, height = H): FrameFeatures {
  const fb = new FeatureBuilder(W, height);
  for (let y = 0; y < height; y += 1) fb.addRow(y, img.subarray(y * W * 4, (y + 1) * W * 4));
  return fb.result();
}

/** Compose the stitched image in memory through the real emit path. */
async function compose(frames: Uint8Array[], analysis: ReturnType<typeof analyzeFrames>) {
  const out = new Uint8Array(analysis.width * analysis.height * 4);
  let row = 0;
  await emitSegments(
    analysis,
    async (frame, onRow, stop) => {
      const img = frames[frame]!;
      for (let y = 0; y <= stop; y += 1) onRow(y, img.subarray(y * W * 4, (y + 1) * W * 4));
    },
    (rgba) => {
      out.set(rgba.subarray(0, W * 4), row * W * 4);
      row += 1;
    },
  );
  return out;
}

/** Page rows [from, to) as they'd appear in content (no indicator). */
function pageRowsMatch(out: Uint8Array, outY: number, pageY: number): boolean {
  for (let x = 0; x < W - 8; x += 1) {
    const o = (outY * W + x) * 4;
    const p = (pageY * W + x) * 4;
    if (out[o] !== PAGE[p] || out[o + 1] !== PAGE[p + 1] || out[o + 2] !== PAGE[p + 2]) {
      return false;
    }
  }
  return true;
}

test('stitch: steady scroll reproduces the page exactly, chrome once', async () => {
  const scrolls = [0, 210, 430, 430, 655, 860, 1100, 1333, 1500];
  const imgs = scrolls.map((s, i) => screen(s, i));
  const analysis = analyzeFrames(imgs.map((m) => features(m)), { mode: 'record' });
  assert.equal(analysis.duplicates, 1, 'the paused frame is dropped');
  assert.equal(analysis.stackedSeams, 0, 'every seam matched');
  assert.equal(analysis.header >= CONTENT_TOP - 2, true, `header ${analysis.header}`);
  assert.equal(analysis.footer >= TAB - 2, true, `footer ${analysis.footer}`);
  const last = scrolls[scrolls.length - 1]!;
  // status+nav, then page [header-CONTENT_TOP .. last+CONTENT_H), then tab bar
  const expectedHeight = analysis.header + (last + CONTENT_H - (analysis.header - CONTENT_TOP)) + analysis.footer
    - (analysis.footer - TAB) - (analysis.header - CONTENT_TOP);
  assert.equal(analysis.height, CONTENT_TOP + last + CONTENT_H + TAB, `height ${analysis.height} vs ${expectedHeight}`);
  const out = await compose(imgs, analysis);
  // Every page row appears exactly where it should.
  let bad = 0;
  for (let py = 0; py < last + CONTENT_H; py += 1) {
    if (!pageRowsMatch(out, CONTENT_TOP + py, py)) bad += 1;
  }
  assert.equal(bad, 0, `${bad} page rows differ`);
  // The tab bar appears once, at the very bottom.
  const tabRow = (analysis.height - TAB + 2) * W * 4;
  assert.equal(out[tabRow], 235);
});

function isFloatPixel(out: Uint8Array, y: number, x: number): boolean {
  const o = (y * W + x) * 4;
  return out[o] === FLOAT.r && out[o + 1] === FLOAT.g && out[o + 2] === FLOAT.b;
}

test('stitch: a fixed floating button is kept once and content stays continuous', async () => {
  // Small steps (25px) are shorter than the button, which is how copies
  // stack on top of each other; larger steps still include the whole button.
  const scrolls = [0, 160, 185, 420, 445, 700];
  const imgs = scrolls.map((s, i) => screen(s, i, false, true));
  const analysis = analyzeFrames(imgs.map((m) => features(m)), { mode: 'record' });
  assert.equal(analysis.stackedSeams, 0, 'every seam matched');
  assert.equal(analysis.duplicates, 0);
  assert.ok(analysis.header >= CONTENT_TOP - 2, `header ${analysis.header}`);
  assert.ok(analysis.footer >= TAB - 2, `footer ${analysis.footer}`);
  assert.ok(analysis.stamps.length >= 1, 'the button is stamped once from the last frame');
  assert.ok(analysis.repairs.length > 0, 'covered content is filled from another frame');
  const out = await compose(imgs, analysis);
  const last = scrolls[scrolls.length - 1]!;
  let bad = 0;
  for (let py = 0; py < last + CONTENT_H; py += 1) {
    const outY = CONTENT_TOP + py;
    for (let x = 0; x < W - 80; x += 1) {
      const o = (outY * W + x) * 4;
      const p = (py * W + x) * 4;
      if (out[o] !== PAGE[p] || out[o + 1] !== PAGE[p + 1] || out[o + 2] !== PAGE[p + 2]) {
        bad += 1;
        break;
      }
    }
  }
  assert.equal(bad, 0, `${bad} content rows broke beside the button`);

  // One solid square: a run of rows that contain the button colour, and
  // no second run further up the page.
  const rowsWithButton: number[] = [];
  for (let y = 0; y < analysis.height; y += 1) {
    let hit = false;
    for (let x = 0; x < W; x += 1) {
      if (isFloatPixel(out, y, x)) {
        hit = true;
        break;
      }
    }
    if (hit) rowsWithButton.push(y);
  }
  assert.ok(rowsWithButton.length > 0, 'the floating square is missing');
  const runs: number[][] = [[rowsWithButton[0]!]];
  for (let i = 1; i < rowsWithButton.length; i += 1) {
    const y = rowsWithButton[i]!;
    const cur = runs[runs.length - 1]!;
    if (y === cur[cur.length - 1]! + 1) cur.push(y);
    else runs.push([y]);
  }
  assert.equal(runs.length, 1, `floating square repeated in ${runs.length} places: ${runs.map((r) => r[0]).join(',')}`);
  const run = runs[0]!;
  assert.ok(run.length >= FLOAT_SIZE - 4 && run.length <= FLOAT_SIZE + 20, `square height ${run.length}`);
  assert.ok(run[0]! > analysis.height - H, `square at y ${run[0]} is not on the last screen`);
  // The square itself is the magenta block, once, not a smear of it.
  let magenta = 0;
  for (const y of run) {
    for (let x = 0; x < W; x += 1) if (isFloatPixel(out, y, x)) magenta += 1;
  }
  assert.ok(magenta >= (FLOAT_SIZE - 4) * (FLOAT_SIZE - 4), `only ${magenta} button pixels`);
});

test('stitch: no height cap — a 40-screen recording stitches in full', async () => {
  const scrolls: number[] = [];
  for (let s = 0; s <= PAGE_H - CONTENT_H; s += 140) scrolls.push(s);
  const feats = scrolls.map((s, i) => features(screen(s, i)));
  const analysis = analyzeFrames(feats, { mode: 'record' });
  assert.equal(analysis.stackedSeams, 0);
  const last = scrolls[scrolls.length - 1]!;
  assert.equal(analysis.height, CONTENT_TOP + last + CONTENT_H + TAB);
  assert.ok(analysis.height > 5000, `height ${analysis.height} is beyond the old 8192/scale caps`);
});

test('stitch: Control Center frames at the start and end are trimmed', async () => {
  const scrolls = [0, 0, 0, 200, 420, 640, 640];
  const overlay = [true, true, false, false, false, false, true];
  const imgs = scrolls.map((s, i) => screen(s, i, overlay[i]));
  // make the two leading overlay frames differ slightly (countdown)
  imgs[1]![(200 * W + 100) * 4] = 0;
  const analysis = analyzeFrames(imgs.map((m) => features(m)), { mode: 'record' });
  assert.ok(analysis.trimmed >= 2, `trimmed ${analysis.trimmed}`);
  assert.equal(analysis.stackedSeams, 0);
  assert.equal(analysis.used.includes(0), false);
  assert.equal(analysis.used.includes(6), false);
  const out = await compose(imgs, analysis);
  let bad = 0;
  for (let py = 0; py < 640 + CONTENT_H; py += 1) {
    if (!pageRowsMatch(out, CONTENT_TOP + py, py)) bad += 1;
  }
  assert.equal(bad, 0);
});

test('stitch: a jump with no overlap is stacked and reported', () => {
  const imgs = [screen(0, 0), screen(200, 1), screen(2600, 2), screen(2800, 3)];
  const analysis = analyzeFrames(imgs.map((m) => features(m)), { mode: 'photos' });
  assert.equal(analysis.stackedSeams, 1);
  assert.equal(analysis.used.length, 4);
});

test('stitch: picked screenshots of different heights still join', () => {
  // second "screenshot" is a taller crop
  const a = screen(0, 0);
  const tallH = H + 100;
  const b = new Uint8Array(W * tallH * 4);
  const bb = screen(300, 1);
  b.set(bb);
  b.fill(255, bb.length);
  const fa = features(a);
  const fbb = new FeatureBuilder(W, tallH);
  for (let y = 0; y < tallH; y += 1) fbb.addRow(y, b.subarray(y * W * 4, (y + 1) * W * 4));
  const analysis = analyzeFrames([fa, fbb.result()], { mode: 'photos' });
  assert.equal(analysis.used.length, 2);
  assert.ok(analysis.height > H);
});

test('stitch: written PNG decodes to the composed rows', async () => {
  const scrolls = [0, 250, 500];
  const imgs = scrolls.map((s, i) => screen(s, i));
  const analysis = analyzeFrames(imgs.map((m) => features(m)), { mode: 'record' });
  const chunks: Uint8Array[] = [];
  const writer = new PngStreamWriter({ write: (b) => chunks.push(b.slice()) }, analysis.width, analysis.height);
  await emitSegments(
    analysis,
    async (frame, onRow, stop) => {
      const img = imgs[frame]!;
      for (let y = 0; y <= stop; y += 1) onRow(y, img.subarray(y * W * 4, (y + 1) * W * 4));
    },
    (rgba) => writer.writeRow(rgba),
  );
  writer.finish();
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    png.set(c, at);
    at += c.length;
  }
  const raw = analysis.width * analysis.height * 3;
  assert.ok(size < raw / 3, `compressed ${size} vs raw ${raw}`);
  const expected = await compose(imgs, analysis);
  let y0 = 0;
  let mismatches = 0;
  decodePngRows(png, (y, rgba) => {
    for (let x = 0; x < W * 4; x += 1) if (rgba[x] !== expected[y * W * 4 + x]) mismatches += 1;
    y0 = y;
  });
  assert.equal(y0, analysis.height - 1);
  assert.equal(mismatches, 0);
});

test('stitch: single frame is returned whole', () => {
  const analysis = analyzeFrames([features(screen(0, 0))], { mode: 'record' });
  assert.equal(analysis.height, H);
  assert.deepEqual(analysis.segments, [{ frame: 0, from: 0, to: H }]);
});

test('stitch: capture noise does not break seams or repeat the tab bar', () => {
  const r = rng(11);
  const noisy = (img: Uint8Array) => {
    const out = new Uint8Array(img);
    for (let i = 0; i < out.length; i += 4) {
      const n = Math.round((r() - 0.5) * 6);
      out[i] = Math.max(0, Math.min(255, out[i]! + n));
      out[i + 1] = Math.max(0, Math.min(255, out[i + 1]! + n));
      out[i + 2] = Math.max(0, Math.min(255, out[i + 2]! + n));
    }
    return out;
  };
  const scrolls = [0, 180, 390, 600, 777, 1000];
  const analysis = analyzeFrames(
    scrolls.map((s, i) => features(noisy(screen(s, i)))),
    { mode: 'photos' },
  );
  assert.equal(analysis.stackedSeams, 0);
  assert.ok(analysis.footer >= TAB, `footer ${analysis.footer} must cover the tab bar`);
  assert.ok(analysis.header >= CONTENT_TOP, `header ${analysis.header} must cover the bars`);
  assert.equal(analysis.height, CONTENT_TOP + 1000 + CONTENT_H + TAB);
});


test('hide details: rectangle becomes flat blocks, the rest is untouched', () => {
  const w = 60;
  const h = 50;
  const rows: Uint8Array[] = [];
  const sink = new PixelateSink(w, [{ x: 13, y: 7, width: 20, height: 15 }], 12, (r) => rows.push(r.slice()));
  const src: Uint8Array[] = [];
  for (let y = 0; y < h; y += 1) {
    const row = new Uint8Array(w * 4);
    for (let x = 0; x < w; x += 1) {
      row[x * 4] = (x * 37 + y * 11) & 255;
      row[x * 4 + 1] = (x * 5) & 255;
      row[x * 4 + 2] = (y * 9) & 255;
      row[x * 4 + 3] = 255;
    }
    src.push(row);
    sink.writeRow(row);
  }
  sink.finish();
  assert.equal(rows.length, h);
  // padded to the 12-px grid: x 12..36, y 0..24
  const px = (y: number, x: number) => Array.from(rows[y]!.subarray(x * 4, x * 4 + 3)).join(',');
  for (const [bx, by] of [[12, 0], [24, 12]] as const) {
    const ref = px(by, bx);
    for (let y = by; y < by + 12; y += 1) for (let x = bx; x < bx + 12; x += 1) assert.equal(px(y, x), ref);
  }
  // outside the padded rect: identical to the source
  for (const [x, y] of [[0, 0], [40, 5], [20, 30], [59, 49]] as const) {
    assert.deepEqual(rows[y]!.subarray(x * 4, x * 4 + 4), src[y]!.subarray(x * 4, x * 4 + 4));
  }
});
