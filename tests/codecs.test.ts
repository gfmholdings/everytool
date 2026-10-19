import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodePngRows,
  inflateRaw,
  PngStreamWriter,
} from '../src/lib/deflate.ts';
import { encodeGif, quantizeFrame } from '../src/lib/gifenc.ts';

function collectPng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const sink = { write: (b: Uint8Array) => chunks.push(new Uint8Array(b)) };
  const writer = new PngStreamWriter(sink, width, height);
  for (let y = 0; y < height; y += 1) {
    writer.writeRow(rgba.subarray(y * width * 4, (y + 1) * width * 4));
  }
  writer.finish();
  return new Uint8Array(chunks.flatMap((c) => [...c]));
}

function pattern(w: number, h: number, fn: (x: number, y: number) => number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      data[i] = fn(x, y);
      data[i + 1] = fn(x + 40, y + 9);
      data[i + 2] = fn(x * 3, y * 7);
      data[i + 3] = 255;
    }
  }
  return data;
}

test('PNG roundtrip: writer output decodes back exactly', () => {
  const w = 37;
  const h = 23;
  const rgba = pattern(w, h, (x, y) => (x * 7 + y * 13) % 256);
  const png = collectPng(w, h, rgba);
  assert.equal(png[0], 0x89);
  assert.equal(String.fromCharCode(...png.slice(1, 4)), 'PNG');
  const rows: number[] = [];
  const info = decodePngRows(png, (_y, row) => rows.push(...row));
  assert.equal(info.width, w);
  assert.equal(info.height, h);
  assert.deepEqual(new Uint8Array(rows), rgba);
});

test('PNG roundtrip: tall strip (multi-block stored stream)', () => {
  const w = 64;
  const h = 600; // 600 * 257 bytes of scanlines > 65535 → several blocks
  const rgba = pattern(w, h, (x, y) => (x + y) % 256);
  const png = collectPng(w, h, rgba);
  let rowCount = 0;
  decodePngRows(png, () => {
    rowCount += 1;
  });
  assert.equal(rowCount, h);
});

test('inflateRaw: stored blocks roundtrip, incl. multi-block', () => {
  const original = new Uint8Array(150000);
  for (let i = 0; i < original.length; i += 1) original[i] = (i * 31) % 256;
  // Hand-build a raw DEFLATE stream of stored blocks.
  const out: number[] = [];
  let pos = 0;
  while (pos < original.length) {
    const take = Math.min(65535, original.length - pos);
    const last = pos + take >= original.length;
    out.push(last ? 1 : 0, take & 0xff, (take >> 8) & 0xff, ~take & 0xff, (~take >> 8) & 0xff);
    for (let i = 0; i < take; i += 1) out.push(original[pos + i] ?? 0);
    pos += take;
  }
  assert.deepEqual(inflateRaw(new Uint8Array(out)), original);
});

test('inflateRaw rejects garbage', () => {
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff])));
});

test('GIF: header, trailer, loop extension present', () => {
  const frame = quantizeFrame(pattern(16, 16, (x) => x * 16));
  const gif = encodeGif([frame, frame], 16, 16, 12);
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
  assert.equal(gif[gif.length - 1], 0x3b);
  const asText = String.fromCharCode(...gif.slice(0, 800));
  assert.ok(asText.includes('NETSCAPE2.0'));
});

test('GIF: LZW output decodes back to the source indices', () => {
  const indices = quantizeFrame(pattern(31, 17, (x, y) => (x * y * 5 + x) % 256));
  const gif = encodeGif([indices], 31, 17, 12);
  // Layout: header 6 + LSD 7 + palette 768 + NETSCAPE ext 19 + GCE 8 +
  // image descriptor 10 → LZW minimum code size byte.
  const dataStart = 6 + 7 + 768 + 19 + 8 + 10;
  assert.equal(gif[dataStart], 8);
  const compressed: number[] = [];
  let p = dataStart + 1;
  for (;;) {
    const len = gif[p] ?? 0;
    p += 1;
    if (len === 0) break;
    for (let i = 0; i < len; i += 1) compressed.push(gif[p + i] ?? 0);
    p += len;
  }
  const codes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of compressed) {
    acc |= byte << bits;
    bits += 8;
    while (bits >= 9) {
      codes.push(acc & 0x1ff);
      acc >>= 9;
      bits -= 9;
    }
  }
  // Decode the encoder's fixed 9-bit dialect (clear 256, EOI 257,
  // dictionary resets before code 512 would be needed).
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: 256 }, (_v, i) => [i]);
    dict[256] = [];
    dict[257] = [];
  };
  reset();
  let prev: number[] | null = null;
  for (const code of codes) {
    if (code === 256) {
      reset();
      prev = null;
      continue;
    }
    if (code === 257) break;
    let entry: number[];
    if (code < dict.length && dict[code] !== undefined && dict[code]!.length > 0) {
      entry = dict[code]!;
    } else if (prev) {
      entry = [...prev, prev[0]!];
    } else {
      throw new Error('bad code stream');
    }
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]!]);
    prev = entry;
  }
  assert.deepEqual(out, [...indices]);
});
