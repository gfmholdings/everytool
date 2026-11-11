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

test('decodePngRows: JPEG bytes are named, not called an unsupported PNG', () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
  assert.throws(() => decodePngRows(jpeg, () => {}), /JPEG/);
});

test('decodePngRows: HEIC (ftyp) bytes are named, not called an unsupported PNG', () => {
  const heic = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
  ]);
  assert.throws(() => decodePngRows(heic, () => {}), /HEIC/);
});

test('decodePngRows: a minimal 1x1 PNG literal decodes', () => {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const png = new Uint8Array(Buffer.from(b64, 'base64'));
  let rowCount = 0;
  const info = decodePngRows(png, () => {
    rowCount += 1;
  });
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
  assert.equal(info.channels, 4);
  assert.equal(rowCount, 1);
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

// --- Hand-built PNGs for the variants phones actually write -----------

import { zlibSync } from 'fflate';

import { crc32Update } from '../src/lib/deflate.ts';

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = crc32Update(0xffffffff, out.subarray(4, 8));
  crc = crc32Update(crc, data);
  dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

interface PngSpec {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace?: number;
  palette?: Uint8Array;
  trns?: Uint8Array;
  /** Scanline bytes, each row prefixed with its filter byte. For
   * interlaced PNGs, the passes' rows concatenated in pass order. */
  scanlines: Uint8Array;
}

function makePng(spec: PngSpec): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, spec.width);
  dv.setUint32(4, spec.height);
  ihdr[8] = spec.bitDepth;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ?? 0;
  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (spec.palette) parts.push(chunk('PLTE', spec.palette));
  if (spec.trns) parts.push(chunk('tRNS', spec.trns));
  parts.push(chunk('IDAT', zlibSync(spec.scanlines)));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function decodeAll(png: Uint8Array): { rows: Uint8Array[]; channels: number } {
  const rows: Uint8Array[] = [];
  const info = decodePngRows(png, (_y, row) => rows.push(new Uint8Array(row)));
  return { rows, channels: info.channels };
}

/** 16-bit samples (big-endian) for one filter-0 row of pixels. */
function row16(samples: number[]): Uint8Array {
  const out = new Uint8Array(1 + samples.length * 2);
  samples.forEach((s, i) => {
    out[1 + i * 2] = (s >> 8) & 0xff;
    out[2 + i * 2] = s & 0xff;
  });
  return out;
}

test('decodePngRows: 16-bit RGBA keeps the high byte of each sample', () => {
  const png = makePng({
    width: 2,
    height: 1,
    bitDepth: 16,
    colorType: 6,
    scanlines: row16([0xff80, 0x0000, 0x1234, 0xffff, 0x00ff, 0x8001, 0xffff, 0x0000]),
  });
  const { rows } = decodeAll(png);
  assert.deepEqual([...rows[0]!], [0xff, 0x00, 0x12, 0xff, 0x00, 0x80, 0xff, 0x00]);
});

test('decodePngRows: 16-bit RGB with a Sub filter (filter distance is 6 bytes)', () => {
  const actual = new Uint8Array(12);
  [0x0a11, 0x1422, 0x1e33, 0x0b44, 0x1555, 0x1f66].forEach((s, i) => {
    actual[i * 2] = (s >> 8) & 0xff;
    actual[i * 2 + 1] = s & 0xff;
  });
  const filtered = new Uint8Array(13);
  filtered[0] = 1; // Sub
  for (let i = 0; i < 12; i += 1) {
    filtered[1 + i] = i < 6 ? actual[i]! : (actual[i]! - actual[i - 6]!) & 0xff;
  }
  const png = makePng({
    width: 2, height: 1, bitDepth: 16, colorType: 2, scanlines: filtered,
  });
  const { rows } = decodeAll(png);
  assert.deepEqual([...rows[0]!], [0x0a, 0x14, 0x1e, 255, 0x0b, 0x15, 0x1f, 255]);
});

test('decodePngRows: 16-bit grayscale', () => {
  const png = makePng({
    width: 2, height: 1, bitDepth: 16, colorType: 0,
    scanlines: row16([0x8080, 0x0102]),
  });
  const { rows } = decodeAll(png);
  assert.deepEqual([...rows[0]!], [0x80, 0x80, 0x80, 255, 0x01, 0x01, 0x01, 255]);
});

test('decodePngRows: palette PNG expands through PLTE and tRNS', () => {
  const png = makePng({
    width: 3, height: 1, bitDepth: 8, colorType: 3,
    palette: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]),
    trns: new Uint8Array([128]),
    scanlines: new Uint8Array([0, 0, 1, 2]),
  });
  const { rows, channels } = decodeAll(png);
  assert.equal(channels, 4);
  assert.deepEqual(
    [...rows[0]!],
    [255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255],
  );
});

test('decodePngRows: 4-bit palette indices unpack', () => {
  const png = makePng({
    width: 4, height: 1, bitDepth: 4, colorType: 3,
    palette: new Uint8Array([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]),
    scanlines: new Uint8Array([0, 0x01, 0x23]),
  });
  const { rows } = decodeAll(png);
  assert.deepEqual(
    [...rows[0]!],
    [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255],
  );
});

test('decodePngRows: 4-bit grayscale scales to 0-255', () => {
  const png = makePng({
    width: 3, height: 1, bitDepth: 4, colorType: 0,
    scanlines: new Uint8Array([0, 0x08, 0xf0]),
  });
  const { rows } = decodeAll(png);
  assert.deepEqual(
    [...rows[0]!],
    [0, 0, 0, 255, 136, 136, 136, 255, 255, 255, 255, 255],
  );
});

test('decodePngRows: gray+alpha 8-bit', () => {
  const png = makePng({
    width: 2, height: 1, bitDepth: 8, colorType: 4,
    scanlines: new Uint8Array([0, 200, 90, 30, 255]),
  });
  const { rows } = decodeAll(png);
  assert.deepEqual([...rows[0]!], [200, 200, 200, 90, 30, 30, 30, 255]);
});

/** Build Adam7 scanlines (filter 0 per pass row) for a pixel pattern. */
function interlacedScanlines(
  w: number,
  h: number,
  channels: number,
  pixel: (x: number, y: number) => number[],
): Uint8Array {
  const passes: [number, number, number, number][] = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ];
  const out: number[] = [];
  for (const [xs, ys, xStep, yStep] of passes) {
    const pw = w > xs ? Math.ceil((w - xs) / xStep) : 0;
    const ph = h > ys ? Math.ceil((h - ys) / yStep) : 0;
    if (pw === 0 || ph === 0) continue; // an empty pass emits nothing
    for (let py = 0; py < ph; py += 1) {
      out.push(0);
      for (let px = 0; px < pw; px += 1) {
        out.push(...pixel(xs + px * xStep, ys + py * yStep).slice(0, channels));
      }
    }
  }
  return new Uint8Array(out);
}

test('decodePngRows: Adam7 interlaced RGBA lands every pixel in place', () => {
  const w = 8;
  const h = 8;
  const pixel = (x: number, y: number) => [x * 30, y * 30, (x + y) * 15, 255];
  const png = makePng({
    width: w, height: h, bitDepth: 8, colorType: 6, interlace: 1,
    scanlines: interlacedScanlines(w, h, 4, pixel),
  });
  const { rows } = decodeAll(png);
  assert.equal(rows.length, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      assert.deepEqual(
        [...rows[y]!.subarray(x * 4, x * 4 + 4)],
        pixel(x, y),
        `pixel ${x},${y}`,
      );
    }
  }
});

test('decodePngRows: Adam7 interlaced RGB at an odd size', () => {
  const w = 3;
  const h = 5;
  const pixel = (x: number, y: number) => [x * 80 + 5, y * 40 + 9, 200];
  const png = makePng({
    width: w, height: h, bitDepth: 8, colorType: 2, interlace: 1,
    scanlines: interlacedScanlines(w, h, 3, pixel),
  });
  const { rows } = decodeAll(png);
  assert.equal(rows.length, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      assert.deepEqual(
        [...rows[y]!.subarray(x * 4, x * 4 + 4)],
        [...pixel(x, y), 255],
        `pixel ${x},${y}`,
      );
    }
  }
});
