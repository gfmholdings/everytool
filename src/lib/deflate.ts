import { unzlibSync, Zlib } from 'fflate';

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
 * Stream-decode a PNG, calling onRow once per row with that row's RGBA
 * pixels (width*4 bytes). The row buffer is REUSED between calls — copy
 * it if you keep it. Pass `stopAfterRow` to stop once that row has been
 * delivered (non-interlaced rows are sequential, so the rest of the
 * image is never touched).
 *
 * Every PNG variant a phone can produce is accepted: 8- and 16-bit
 * samples (16-bit keeps the high byte), grayscale, gray+alpha, RGB,
 * RGBA, palette (with tRNS), sub-byte grayscale/palette, and Adam7
 * interlacing. The narrow first version of this decoder rejected the
 * 16-bit and interlaced files newer iPhones write, which surfaced in
 * the app as "Unsupported PNG format." on ordinary screenshots.
 * Interlaced input is the one non-streaming path: passes scatter
 * pixels across the frame, so the frame is assembled in memory and
 * then emitted in row order.
 */
export function decodePngRows(
  bytes: Uint8Array,
  onRow: (y: number, rgbaRow: Uint8Array) => void,
  stopAfterRow?: number,
): PngInfo {
  // Verify the PNG signature before chunk parsing, and name the actual
  // format when a foreign file slips through.
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
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
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
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataStart + len);
    } else if (type === 'tRNS') {
      trns = bytes.subarray(dataStart, dataStart + len);
    } else if (type === 'IDAT') {
      parts.push(bytes.subarray(dataStart, dataStart + len));
      idatLength += len;
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
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
            : colorType === 3
              ? 1 // palette: one index per pixel until expanded
              : 0;
  const allowedDepths: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    width === 0 ||
    height === 0 ||
    channels === 0 ||
    interlace > 1 ||
    !(allowedDepths[colorType] ?? []).includes(bitDepth) ||
    (colorType === 3 && palette === null)
  ) {
    throw new Error('Unsupported PNG format.');
  }
  const idat = new Uint8Array(idatLength);
  let at = 0;
  for (const part of parts) {
    idat.set(part, at);
    at += part.length;
  }
  const raw = unzlibSync(idat);
  const bitsPerPixel = colorType === 3 ? bitDepth : channels * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  // PNG filters predict from the previous pixel's bytes: the distance
  // is the byte size of one pixel, at least one byte.
  const filterBpp = Math.max(1, Math.floor(bitsPerPixel / 8));

  /** Unfilter one scanline of `len` bytes from raw[src..] into dest. */
  const unfilter = (
    src: number,
    len: number,
    prev: Uint8Array,
    dest: Uint8Array,
  ): void => {
    const filter = raw[src];
    const data = src + 1;
    switch (filter) {
      case 0:
        dest.set(raw.subarray(data, data + len));
        break;
      case 1:
        for (let x = 0; x < len; x += 1) {
          const a = x >= filterBpp ? dest[x - filterBpp]! : 0;
          dest[x] = (raw[data + x]! + a) & 0xff;
        }
        break;
      case 2:
        for (let x = 0; x < len; x += 1) {
          dest[x] = (raw[data + x]! + prev[x]!) & 0xff;
        }
        break;
      case 3:
        for (let x = 0; x < len; x += 1) {
          const a = x >= filterBpp ? dest[x - filterBpp]! : 0;
          dest[x] = (raw[data + x]! + ((a + prev[x]!) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let x = 0; x < len; x += 1) {
          const a = x >= filterBpp ? dest[x - filterBpp]! : 0;
          const c = x >= filterBpp ? prev[x - filterBpp]! : 0;
          dest[x] = (raw[data + x]! + paeth(a, prev[x]!, c)) & 0xff;
        }
        break;
      default:
        throw new Error('Corrupt PNG row filter.');
    }
  };

  const maxSample = (1 << bitDepth) - 1;
  /** The i-th packed sample (bit depth 1/2/4) of an unfiltered row. */
  const packedSample = (row: Uint8Array, i: number): number => {
    const bitPos = i * bitDepth;
    const byte = row[bitPos >> 3] ?? 0;
    const shift = 8 - bitDepth - (bitPos & 7);
    return (byte >> shift) & maxSample;
  };

  /**
   * Expand `count` pixels of an unfiltered row to RGBA through `put`.
   * For 16-bit samples the high byte is the 8-bit value (PNG stores
   * samples big-endian, and the low byte is precision phones never
   * display).
   */
  const expand = (
    row: Uint8Array,
    count: number,
    put: (x: number, r: number, g: number, b: number, a: number) => void,
  ): void => {
    if (colorType === 3) {
      const pal = palette!;
      for (let x = 0; x < count; x += 1) {
        const idx = bitDepth === 8 ? row[x]! : packedSample(row, x);
        const p = idx * 3;
        put(
          x,
          pal[p] ?? 0,
          pal[p + 1] ?? 0,
          pal[p + 2] ?? 0,
          trns !== null && idx < trns.length ? trns[idx]! : 255,
        );
      }
      return;
    }
    if (bitDepth < 8) {
      // Sub-byte depths are grayscale-only per the spec.
      for (let x = 0; x < count; x += 1) {
        const v = Math.round((packedSample(row, x) * 255) / maxSample);
        put(x, v, v, v, 255);
      }
      return;
    }
    const sampleBytes = bitDepth / 8; // 1 or 2
    for (let x = 0; x < count; x += 1) {
      const base = x * channels * sampleBytes;
      const s0 = row[base]!;
      if (channels === 1) {
        put(x, s0, s0, s0, 255);
      } else if (channels === 2) {
        put(x, s0, s0, s0, row[base + sampleBytes]!);
      } else if (channels === 3) {
        put(x, s0, row[base + sampleBytes]!, row[base + 2 * sampleBytes]!, 255);
      } else {
        put(
          x,
          s0,
          row[base + sampleBytes]!,
          row[base + 2 * sampleBytes]!,
          row[base + 3 * sampleBytes]!,
        );
      }
    }
  };

  const last =
    stopAfterRow === undefined
      ? height - 1
      : Math.min(height - 1, stopAfterRow);
  const rgba = new Uint8Array(width * 4);

  if (interlace === 0) {
    if (raw.length < (rowBytes + 1) * height) {
      throw new Error('PNG data is truncated.');
    }
    let prev = new Uint8Array(rowBytes);
    let row = new Uint8Array(rowBytes);
    for (let y = 0; y <= last; y += 1) {
      unfilter(y * (rowBytes + 1), rowBytes, prev, row);
      expand(row, width, (x, r, g, b, a) => {
        const d = x * 4;
        rgba[d] = r;
        rgba[d + 1] = g;
        rgba[d + 2] = b;
        rgba[d + 3] = a;
      });
      onRow(y, rgba);
      const t = prev;
      prev = row;
      row = t;
    }
  } else {
    // Adam7: seven passes, each with its own filtered scanlines. A
    // pass covers a strided subset of the frame; pixels scatter into
    // the assembled frame, which is then emitted in row order.
    const frame = new Uint8Array(width * height * 4);
    const passes: [number, number, number, number][] = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
    let offset = 0;
    for (const [xStart, yStart, xStep, yStep] of passes) {
      const pw = width > xStart ? Math.ceil((width - xStart) / xStep) : 0;
      const ph = height > yStart ? Math.ceil((height - yStart) / yStep) : 0;
      if (pw === 0 || ph === 0) continue;
      const passRowBytes = Math.ceil((pw * bitsPerPixel) / 8);
      if (raw.length < offset + (passRowBytes + 1) * ph) {
        throw new Error('PNG data is truncated.');
      }
      let prev = new Uint8Array(passRowBytes);
      let row = new Uint8Array(passRowBytes);
      for (let py = 0; py < ph; py += 1) {
        unfilter(offset, passRowBytes, prev, row);
        offset += passRowBytes + 1;
        const y = yStart + py * yStep;
        expand(row, pw, (px, r, g, b, a) => {
          const d = (y * width + xStart + px * xStep) * 4;
          frame[d] = r;
          frame[d + 1] = g;
          frame[d + 2] = b;
          frame[d + 3] = a;
        });
        const t = prev;
        prev = row;
        row = t;
      }
    }
    for (let y = 0; y <= last; y += 1) {
      rgba.set(frame.subarray(y * width * 4, (y + 1) * width * 4));
      onRow(y, rgba);
    }
  }
  return {
    width,
    height,
    channels: colorType === 3 ? 4 : channels,
  };
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
