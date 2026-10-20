/**
 * Pure GIF89a encoder: fixed 216-color cube palette quantizer + LZW.
 * No imports — unit-testable in Node.
 */

export const GIF_MAX_SECONDS = 5;
export const GIF_FPS = 8;
export const GIF_WIDTH = 360;

const LEVELS = [0, 51, 102, 153, 204, 255];

function gifPalette(): number[] {
  const palette: number[] = [];
  for (const r of LEVELS)
    for (const g of LEVELS) for (const b of LEVELS) palette.push(r, g, b);
  for (let i = 0; i < 40; i += 1) {
    const gray = Math.round((i / 39) * 255);
    palette.push(gray, gray, gray);
  }
  return palette;
}

export function quantizeFrame(rgba: Uint8Array): Uint8Array {
  const pixels = rgba.length / 4;
  const out = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const p = i * 4;
    const r = Math.round((rgba[p] ?? 0) / 51);
    const g = Math.round((rgba[p + 1] ?? 0) / 51);
    const b = Math.round((rgba[p + 2] ?? 0) / 51);
    out[i] = r * 36 + g * 6 + b;
  }
  return out;
}

class BitPacker {
  bytes: number[] = [];
  private cur = 0;
  private bits = 0;
  write(code: number, size: number) {
    this.cur |= code << this.bits;
    this.bits += size;
    while (this.bits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.bits -= 8;
    }
  }
  flush() {
    if (this.bits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.bits = 0;
    }
  }
}

function lzwGif(indices: Uint8Array): number[] {
  const CLEAR = 256;
  const EOI = 257;
  const CODE_SIZE = 9; // fixed: the dictionary resets before 512
  const packer = new BitPacker();
  let dict = new Map<number, number>();
  let next = EOI + 1;
  packer.write(CLEAR, CODE_SIZE);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i] ?? 0;
    const key = prefix * 256 + k;
    const existing = dict.get(key);
    if (existing !== undefined) {
      prefix = existing;
    } else {
      packer.write(prefix, CODE_SIZE);
      if (next < 512) {
        dict.set(key, next);
        next += 1;
      } else {
        packer.write(CLEAR, CODE_SIZE);
        dict = new Map();
        next = EOI + 1;
      }
      prefix = k;
    }
  }
  packer.write(prefix, CODE_SIZE);
  packer.write(EOI, CODE_SIZE);
  packer.flush();
  return packer.bytes;
}

export function encodeGif(
  frames: Uint8Array[],
  width: number,
  height: number,
  delayCs: number,
  palette?: Uint8Array,
): Uint8Array {
  const bytes: number[] = [];
  const pushStr = (s: string) => {
    for (let i = 0; i < s.length; i += 1) bytes.push(s.charCodeAt(i));
  };
  const push16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };
  pushStr('GIF89a');
  push16(width);
  push16(height);
  bytes.push(0xf7, 0, 0); // 256-entry global palette
  if (palette) {
    for (let i = 0; i < 768; i += 1) bytes.push(palette[i] ?? 0);
  } else {
    bytes.push(...gifPalette());
  }
  bytes.push(0x21, 0xff, 11);
  pushStr('NETSCAPE2.0');
  bytes.push(3, 1, 0, 0, 0); // loop forever
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 4, 0, delayCs & 0xff, (delayCs >> 8) & 0xff, 0, 0);
    bytes.push(0x2c);
    push16(0);
    push16(0);
    push16(width);
    push16(height);
    bytes.push(0);
    bytes.push(8); // LZW minimum code size
    const compressed = lzwGif(frame);
    for (let i = 0; i < compressed.length; i += 255) {
      const chunk = compressed.slice(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Better colour: one adaptive 256-colour palette for the whole clip
// (median cut over sampled pixels of every frame) + 4×4 ordered dithering.
// One shared palette keeps colours stable from frame to frame (no
// flicker) and the dither pattern is fixed, so still areas stay still.
// ---------------------------------------------------------------------------

interface Box {
  px: Uint8Array; // packed r,g,b triples
  n: number;
}

function channelRange(b: Box, c: number): number {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < b.n; i += 1) {
    const v = b.px[i * 3 + c]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

/** Median-cut palette (768 bytes, RGB × 256) from sampled frame pixels. */
export function buildPalette(frames: Uint8Array[], size = 256, maxSamples = 60000): Uint8Array {
  const total = frames.reduce((n, f) => n + f.length / 4, 0);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const samples: number[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (k++ % step === 0) samples.push(f[i]!, f[i + 1]!, f[i + 2]!);
    }
  }
  const boxes: Box[] = [{ px: Uint8Array.from(samples), n: samples.length / 3 }];
  while (boxes.length < size) {
    // split the box with the widest channel range (and >1 pixel)
    let bi = -1;
    let best = -1;
    let bc = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i]!;
      if (b.n < 2) continue;
      for (let c = 0; c < 3; c += 1) {
        const r = channelRange(b, c);
        if (r > best) {
          best = r;
          bi = i;
          bc = c;
        }
      }
    }
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi]!;
    const idx = Array.from({ length: b.n }, (_, i) => i).sort(
      (x, y) => b.px[x * 3 + bc]! - b.px[y * 3 + bc]!,
    );
    const mid = Math.floor(b.n / 2);
    const make = (from: number, to: number): Box => {
      const px = new Uint8Array((to - from) * 3);
      for (let i = from; i < to; i += 1) px.set(b.px.subarray(idx[i]! * 3, idx[i]! * 3 + 3), (i - from) * 3);
      return { px, n: to - from };
    };
    boxes.splice(bi, 1, make(0, mid), make(mid, b.n));
  }
  const pal = new Uint8Array(768);
  boxes.forEach((b, i) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let j = 0; j < b.n; j += 1) {
      r += b.px[j * 3]!;
      g += b.px[j * 3 + 1]!;
      bl += b.px[j * 3 + 2]!;
    }
    const n = Math.max(1, b.n);
    pal[i * 3] = Math.round(r / n);
    pal[i * 3 + 1] = Math.round(g / n);
    pal[i * 3 + 2] = Math.round(bl / n);
  });
  return pal;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Map one RGBA frame onto the palette with 4×4 ordered dithering. */
export function quantizeWithPalette(
  rgba: Uint8Array,
  width: number,
  palette: Uint8Array,
  dither = true,
  cache: Int16Array = new Int16Array(32768).fill(-1),
): Uint8Array {
  const pixels = rgba.length / 4;
  const out = new Uint8Array(pixels);
  const colors = Math.min(256, palette.length / 3);
  for (let i = 0; i < pixels; i += 1) {
    const x = i % width;
    const y = (i / width) | 0;
    const d = dither ? (BAYER4[(y & 3) * 4 + (x & 3)]! - 7.5) * 2 : 0;
    const r = Math.max(0, Math.min(255, rgba[i * 4]! + d));
    const g = Math.max(0, Math.min(255, rgba[i * 4 + 1]! + d));
    const b = Math.max(0, Math.min(255, rgba[i * 4 + 2]! + d));
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let best = cache[key]!;
    if (best < 0) {
      let bestD = Infinity;
      const cr = (r & ~7) + 4;
      const cg = (g & ~7) + 4;
      const cb = (b & ~7) + 4;
      for (let p = 0; p < colors; p += 1) {
        const dr = palette[p * 3]! - cr;
        const dg = palette[p * 3 + 1]! - cg;
        const db = palette[p * 3 + 2]! - cb;
        const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (dist < bestD) {
          bestD = dist;
          best = p;
        }
      }
      cache[key] = best;
    }
    out[i] = best;
  }
  return out;
}

/** The frame plan (pure): start/length clamped to the clip, frame times in ms. */
export function planGif(o: {
  durationSec: number;
  startSec?: number;
  lengthSec?: number;
  fps?: number;
}): { times: number[]; fps: number } {
  const fps = Math.max(1, Math.min(15, Math.round(o.fps ?? GIF_FPS)));
  const dur = o.durationSec > 0 ? o.durationSec : GIF_MAX_SECONDS;
  const start = Math.max(0, Math.min(o.startSec ?? 0, Math.max(0, dur - 0.2)));
  const length = Math.max(0.2, Math.min(o.lengthSec ?? GIF_MAX_SECONDS, 10, dur - start));
  const count = Math.max(1, Math.floor(length * fps));
  return {
    fps,
    times: Array.from({ length: count }, (_, i) => Math.round((start + i / fps) * 1000)),
  };
}

