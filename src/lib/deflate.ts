import { unzlibSync, Unzlib, Zlib } from 'fflate';

// PNG codec for Everytool: a spec-written raw DEFLATE decoder (kept for
// tests and tiny inputs), a fast row-streaming PNG decoder and a streaming
// compressed PNG encoder, both on fflate. Pure JS, runs anywhere.
//
// (Original note:) Minimal DEFLATE (RFC 1951) decoder.
// Only used on images Everytool itself produced (via
// expo-image-manipulator): 8-bit, non-interlaced PNGs. Written from the
// spec; no dependencies, runs anywhere JS runs.

export function inflateRaw(data: Uint8Array): Uint8Array {
  let bitPos = 0;
  const readBit = (): number => {
    const byte = data[bitPos >> 3] ?? 0;
    const bit = (byte >> (bitPos & 7)) & 1;
    bitPos += 1;
    return bit;
  };
  const readBits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i += 1) v |= readBit() << i;
    return v;
  };
  const out: number[] = [];

  interface Huff {
    counts: number[];
    symbols: number[];
  }
  const buildHuff = (lengths: number[]): Huff => {
    const counts = new Array(16).fill(0) as number[];
    lengths.forEach((l) => {
      if (l > 0) counts[l] = (counts[l] ?? 0) + 1;
    });
    const offs = new Array(16).fill(0) as number[];
    for (let i = 1; i < 16; i += 1)
      offs[i] = ((offs[i - 1] ?? 0) + (counts[i - 1] ?? 0)) << 1;
    const symbols: number[] = [];
    lengths.forEach((l, sym) => {
      if (l > 0) {
        const idx = offs[l] ?? 0;
        symbols[idx] = sym;
        offs[l] = idx + 1;
      }
    });
    return { counts, symbols };
  };
  const decode = (h: Huff): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len += 1) {
      code |= readBit();
      const count = h.counts[len] ?? 0;
      if (code - first < count) return h.symbols[index + (code - first)] ?? 0;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return 0;
  };

  const lengthBase = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const lengthExtra = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0,
  ];
  const distBase = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
    769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const distExtra = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13,
  ];

  for (;;) {
    const bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitPos = Math.ceil(bitPos / 8) * 8;
      const len = readBits(16);
      readBits(16);
      for (let i = 0; i < len; i += 1) out.push(readBits(8));
    } else {
      let litHuff: Huff;
      let distHuff: Huff;
      if (btype === 1) {
        const litLengths = new Array(288).fill(0) as number[];
        for (let i = 0; i < 144; i += 1) litLengths[i] = 8;
        for (let i = 144; i < 256; i += 1) litLengths[i] = 9;
        for (let i = 256; i < 280; i += 1) litLengths[i] = 7;
        for (let i = 280; i < 288; i += 1) litLengths[i] = 8;
        litHuff = buildHuff(litLengths);
        distHuff = buildHuff(new Array(30).fill(5) as number[]);
      } else if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const order = [
          16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
        ];
        const codeLengths = new Array(19).fill(0) as number[];
        for (let i = 0; i < hclen; i += 1) {
          const idx = order[i] ?? 0;
          codeLengths[idx] = readBits(3);
        }
        const codeHuff = buildHuff(codeLengths);
        const lengths: number[] = [];
        while (lengths.length < hlit + hdist) {
          const sym = decode(codeHuff);
          if (sym < 16) {
            lengths.push(sym);
          } else if (sym === 16) {
            const prevLen = lengths[lengths.length - 1] ?? 0;
            const repeat = 3 + readBits(2);
            for (let i = 0; i < repeat; i += 1) lengths.push(prevLen);
          } else if (sym === 17) {
            const repeat = 3 + readBits(3);
            for (let i = 0; i < repeat; i += 1) lengths.push(0);
          } else {
            const repeat = 11 + readBits(7);
            for (let i = 0; i < repeat; i += 1) lengths.push(0);
          }
        }
        litHuff = buildHuff(lengths.slice(0, hlit));
        distHuff = buildHuff(lengths.slice(hlit));
      } else {
        throw new Error('Bad DEFLATE block type.');
      }
      for (;;) {
        const sym = decode(litHuff);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          const len = (lengthBase[li] ?? 3) + readBits(lengthExtra[li] ?? 0);
          const dsym = decode(distHuff);
          const dist = (distBase[dsym] ?? 1) + readBits(distExtra[dsym] ?? 0);
          const start = out.length - dist;
          for (let i = 0; i < len; i += 1) out.push(out[start + i] ?? 0);
        }
      }
    }
    if (bfinal === 1) break;
  }
  return new Uint8Array(out);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export interface PngInfo {
  width: number;
  height: number;
  channels: number; // 1 gray, 2 gray+alpha, 3 RGB, 4 RGBA
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

/** Read width/height from a PNG header without decoding pixels. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
}

/**
 * Stream-decode an 8-bit non-interlaced PNG, calling onRow once per row
 * with that row's RGBA pixels (width*4 bytes). The row buffer is REUSED
 * between calls — copy it if you keep it. Pass `stopAfterRow` to stop
 * unfiltering once that row has been delivered (rows are sequential, so
 * the rest of the image is never touched).
 */
export function decodePngRows(
  bytes: Uint8Array,
  onRow: (y: number, rgbaRow: Uint8Array) => void,
  stopAfterRow?: number,
): PngInfo {
  const parsed = readPngChunks(bytes);
  const stride = parsed.width * parsed.channels;
  const raw = unzlibSync(parsed.idat);
  paintPngRows(raw, parsed.width, parsed.height, parsed.channels, stride, onRow, stopAfterRow);
  return { width: parsed.width, height: parsed.height, channels: parsed.channels };
}

/**
 * Same pixels as {@link decodePngRows}, but the inflate stops once the
 * rows the caller asked for are in hand, and the unfilter yields every
 * few dozen rows. A stitch writes thousands of rows on the JS thread;
 * doing that in one synchronous turn freezes the UI on the last progress
 * line (the "Writing the image · 2 of 7" stall) for the whole segment.
 */
export async function decodePngRowsAsync(
  bytes: Uint8Array,
  onRow: (y: number, rgbaRow: Uint8Array) => void,
  stopAfterRow?: number,
): Promise<PngInfo> {
  const parsed = readPngChunks(bytes);
  const stride = parsed.width * parsed.channels;
  const last =
    stopAfterRow === undefined
      ? parsed.height - 1
      : Math.min(parsed.height - 1, stopAfterRow);
  const raw = inflatePrefix(parsed.idat, (last + 1) * (stride + 1));
  const cursor = new PngRowCursor(raw, parsed.width, parsed.channels, stride, onRow, last);
  const yieldEvery = 48;
  while (!cursor.done) {
    cursor.paint(yieldEvery);
    if (!cursor.done) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  return { width: parsed.width, height: parsed.height, channels: parsed.channels };
}

interface PngChunks {
  width: number;
  height: number;
  channels: number;
  idat: Uint8Array;
}

/** Header + concatenated IDAT. Shared by the sync and yielding decoders. */
function readPngChunks(bytes: Uint8Array): PngChunks {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng =
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b);
  if (!isPng) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      throw new Error(
        'That image is a JPEG — Everytool stitches PNG screenshots.',
      );
    }
    if (
      bytes.length >= 8 &&
      String.fromCharCode(
        bytes[4] ?? 0,
        bytes[5] ?? 0,
        bytes[6] ?? 0,
        bytes[7] ?? 0,
      ) === 'ftyp'
    ) {
      throw new Error(
        'That image is HEIC — Everytool stitches PNG screenshots.',
      );
    }
    throw new Error('Unsupported image format — not a PNG.');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const parts: Uint8Array[] = [];
  let idatLength = 0;
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = readU32(bytes, pos);
    const type = String.fromCharCode(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0,
    );
    const dataStart = pos + 8;
    if (type === 'IHDR') {
      width = readU32(bytes, dataStart);
      height = readU32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8] ?? 8;
      colorType = bytes[dataStart + 9] ?? 6;
      interlace = bytes[dataStart + 12] ?? 0;
    } else if (type === 'IDAT') {
      parts.push(bytes.subarray(dataStart, dataStart + len));
      idatLength += len;
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
  }
  if (bitDepth !== 8 || interlace !== 0 || width === 0) {
    throw new Error('Unsupported PNG format.');
  }
  const channels =
    colorType === 6
      ? 4
      : colorType === 2
        ? 3
        : colorType === 0
          ? 1
          : colorType === 4
            ? 2
            : 0;
  if (channels === 0) throw new Error('Unsupported PNG color type.');
  const idat = new Uint8Array(idatLength);
  let at = 0;
  for (const part of parts) {
    idat.set(part, at);
    at += part.length;
  }
  return { width, height, channels, idat };
}

/**
 * Inflate only the zlib prefix needed for `need` uncompressed bytes.
 * Later rows of a frame the stitch will not use are never decompressed.
 */
function inflatePrefix(idat: Uint8Array, need: number): Uint8Array {
  if (need <= 0) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let got = 0;
  const infl = new Unzlib((chunk) => {
    if (got >= need || chunk.length === 0) return;
    // fflate may reuse the buffer it hands us; copy the bytes we keep.
    const take = Math.min(chunk.length, need - got);
    chunks.push(chunk.slice(0, take));
    got += take;
  });
  const step = 32 * 1024;
  for (let off = 0; off < idat.length && got < need; off += step) {
    const end = Math.min(idat.length, off + step);
    try {
      infl.push(idat.subarray(off, end), end === idat.length);
    } catch (e) {
      if (got < need) {
        throw e instanceof Error ? e : new Error('PNG data is truncated.');
      }
      break;
    }
  }
  if (got < need) throw new Error('PNG data is truncated.');
  const raw = new Uint8Array(need);
  let at = 0;
  for (const c of chunks) {
    raw.set(c, at);
    at += c.length;
  }
  return raw;
}

/** Unfilter rows `0..stopAfterRow`. Synchronous: callers that must throw
 *  (and the unit tests) depend on that. */
function paintPngRows(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
  stride: number,
  onRow: (y: number, rgbaRow: Uint8Array) => void,
  stopAfterRow?: number,
): void {
  const last = stopAfterRow === undefined ? height - 1 : Math.min(height - 1, stopAfterRow);
  new PngRowCursor(raw, width, channels, stride, onRow, last).paint(last + 1);
}

/** One forward pass over inflated PNG rows. `paint(n)` continues where
 *  the previous call stopped, so a yield does not restart the filter. */
class PngRowCursor {
  private raw: Uint8Array;
  private width: number;
  private channels: number;
  private stride: number;
  private onRow: (y: number, rgbaRow: Uint8Array) => void;
  private prev: Uint8Array;
  private row: Uint8Array;
  private rgba: Uint8Array;
  private y = 0;
  readonly last: number;

  constructor(
    raw: Uint8Array,
    width: number,
    channels: number,
    stride: number,
    onRow: (y: number, rgbaRow: Uint8Array) => void,
    last: number,
  ) {
    this.raw = raw;
    this.width = width;
    this.channels = channels;
    this.stride = stride;
    this.onRow = onRow;
    this.last = last;
    if (last >= 0 && raw.length < (stride + 1) * (last + 1)) {
      throw new Error('PNG data is truncated.');
    }
    this.prev = new Uint8Array(stride);
    this.row = new Uint8Array(stride);
    this.rgba = new Uint8Array(width * 4);
  }

  get done(): boolean {
    return this.y > this.last;
  }

  paint(count: number): void {
    const end = Math.min(this.last, this.y + count - 1);
    const { raw, stride, channels, width, rgba } = this;
    for (; this.y <= end; this.y += 1) {
      const y = this.y;
      const row = this.row;
      const prev = this.prev;
      const rowStart = y * (stride + 1);
      const filter = raw[rowStart];
      const src = rowStart + 1;
      switch (filter) {
        case 0:
          row.set(raw.subarray(src, src + stride));
          break;
        case 1:
          for (let x = 0; x < stride; x += 1) {
            const a = x >= channels ? row[x - channels]! : 0;
            row[x] = (raw[src + x]! + a) & 0xff;
          }
          break;
        case 2:
          for (let x = 0; x < stride; x += 1) {
            row[x] = (raw[src + x]! + prev[x]!) & 0xff;
          }
          break;
        case 3:
          for (let x = 0; x < stride; x += 1) {
            const a = x >= channels ? row[x - channels]! : 0;
            row[x] = (raw[src + x]! + ((a + prev[x]!) >> 1)) & 0xff;
          }
          break;
        case 4:
          for (let x = 0; x < stride; x += 1) {
            const a = x >= channels ? row[x - channels]! : 0;
            const c = x >= channels ? prev[x - channels]! : 0;
            row[x] = (raw[src + x]! + paeth(a, prev[x]!, c)) & 0xff;
          }
          break;
        default:
          throw new Error('Corrupt PNG row filter.');
      }
      if (channels === 4) {
        rgba.set(row);
      } else {
        for (let x = 0, si = 0, di = 0; x < width; x += 1, si += channels, di += 4) {
          const v = row[si]!;
          if (channels >= 3) {
            rgba[di] = v;
            rgba[di + 1] = row[si + 1]!;
            rgba[di + 2] = row[si + 2]!;
            rgba[di + 3] = 255;
          } else {
            rgba[di] = v;
            rgba[di + 1] = v;
            rgba[di + 2] = v;
            rgba[di + 3] = channels === 2 ? row[si + 1]! : 255;
          }
        }
      }
      this.onRow(y, rgba);
      const t = this.prev;
      this.prev = this.row;
      this.row = t;
    }
  }
}

// -- Streaming PNG writer (stored DEFLATE blocks; valid PNG, no compression)

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff]! ^ (c >>> 8);
  }
  return c;
}

export function adler32Update(adler: number, bytes: Uint8Array): number {
  let a = adler & 0xffff;
  let b = (adler >>> 16) & 0xffff;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + (bytes[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(v: number): Uint8Array {
  return new Uint8Array([
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ]);
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export interface ByteSink {
  write: (bytes: Uint8Array) => void;
}

export interface PngWriterOptions {
  /** zlib level 0–9; 0 writes stored blocks. Default 4 (fast, ~10–20× on screenshots). */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Keep the alpha channel (RGBA). Default false: screenshots are opaque, RGB is 25% smaller. */
  alpha?: boolean;
}

const IDAT_CHUNK = 256 * 1024;

/**
 * Streaming PNG encoder: feed RGBA rows top to bottom. Rows are filtered
 * (Up), compressed by a streaming zlib (fflate) and emitted as IDAT
 * chunks, so an image of any height is written with memory for a couple
 * of rows plus the compressor window — long screenshots have no height
 * limit beyond free storage.
 */
export class PngStreamWriter {
  private sink: ByteSink;
  private width: number;
  private height: number;
  private channels: number;
  private zlib: Zlib;
  private prev: Uint8Array;
  private framed: Uint8Array;
  private out: Uint8Array;
  private outLen = 0;
  private rows = 0;
  private finished = false;

  constructor(sink: ByteSink, width: number, height: number, opts: PngWriterOptions = {}) {
    if (width <= 0 || height <= 0) throw new Error('Image has no size.');
    this.sink = sink;
    this.width = width;
    this.height = height;
    this.channels = opts.alpha ? 4 : 3;
    const stride = width * this.channels;
    this.prev = new Uint8Array(stride);
    this.framed = new Uint8Array(stride + 1);
    this.out = new Uint8Array(IDAT_CHUNK);
    sink.write(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const ihdr = new Uint8Array(13);
    ihdr.set(u32be(width), 0);
    ihdr.set(u32be(height), 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = this.channels === 4 ? 6 : 2; // RGBA or RGB
    this.writeChunk('IHDR', ihdr);
    this.zlib = new Zlib({ level: opts.level ?? 4 });
    this.zlib.ondata = (chunk: Uint8Array) => this.collect(chunk);
  }

  private writeChunk(type: string, data: Uint8Array): void {
    this.sink.write(u32be(data.length));
    const typeBytes = ascii(type);
    this.sink.write(typeBytes);
    this.sink.write(data);
    let crc = crc32Update(0xffffffff, typeBytes);
    crc = crc32Update(crc, data);
    this.sink.write(u32be((crc ^ 0xffffffff) >>> 0));
  }

  private collect(chunk: Uint8Array): void {
    let at = 0;
    while (at < chunk.length) {
      const take = Math.min(chunk.length - at, this.out.length - this.outLen);
      this.out.set(chunk.subarray(at, at + take), this.outLen);
      this.outLen += take;
      at += take;
      if (this.outLen === this.out.length) this.flushIdat();
    }
  }

  private flushIdat(): void {
    if (this.outLen === 0) return;
    this.writeChunk('IDAT', this.out.slice(0, this.outLen));
    this.outLen = 0;
  }

  /** Rows written so far. */
  get rowCount(): number {
    return this.rows;
  }

  writeRow(rgbaRow: Uint8Array): void {
    if (this.finished) throw new Error('PNG already finished.');
    if (this.rows >= this.height) throw new Error('More rows than the PNG height.');
    const { width, channels, framed, prev } = this;
    framed[0] = 2; // filter: Up — screenshots repeat row to row
    if (channels === 4) {
      for (let i = 0; i < width * 4; i += 1) {
        const v = rgbaRow[i] ?? 0;
        framed[i + 1] = (v - prev[i]!) & 0xff;
        prev[i] = v;
      }
    } else {
      for (let x = 0, si = 0, di = 0; x < width; x += 1, si += 4, di += 3) {
        const r = rgbaRow[si] ?? 0;
        const g = rgbaRow[si + 1] ?? 0;
        const b = rgbaRow[si + 2] ?? 0;
        framed[di + 1] = (r - prev[di]!) & 0xff;
        framed[di + 2] = (g - prev[di + 1]!) & 0xff;
        framed[di + 3] = (b - prev[di + 2]!) & 0xff;
        prev[di] = r;
        prev[di + 1] = g;
        prev[di + 2] = b;
      }
    }
    this.rows += 1;
    // fflate may hold a reference to the pushed buffer; push a copy.
    this.zlib.push(framed.slice(), false);
  }

  finish(): void {
    if (this.finished) return;
    if (this.rows !== this.height) {
      throw new Error(`PNG expected ${this.height} rows, got ${this.rows}.`);
    }
    this.finished = true;
    this.zlib.push(new Uint8Array(0), true);
    this.flushIdat();
    this.writeChunk('IEND', new Uint8Array(0));
  }
}
