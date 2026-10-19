// Minimal DEFLATE (RFC 1951) decoder for PNG thumbnails and strips.
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
  channels: number; // 1 gray, 3 RGB, 4 RGBA
}

/**
 * Stream-decode an 8-bit non-interlaced PNG, calling onRow once per row
 * with that row's RGBA pixels (width*4 bytes). Memory stays at one row
 * plus the inflated scanline buffer of the source.
 */
export function decodePngRows(
  bytes: Uint8Array,
  onRow: (y: number, rgbaRow: Uint8Array) => void,
): PngInfo {
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat: number[] = [];
  let pos = 8;
  while (pos < bytes.length) {
    const len =
      ((bytes[pos] ?? 0) << 24) |
      ((bytes[pos + 1] ?? 0) << 16) |
      ((bytes[pos + 2] ?? 0) << 8) |
      (bytes[pos + 3] ?? 0);
    const type = String.fromCharCode(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0,
    );
    const dataStart = pos + 8;
    if (type === 'IHDR') {
      width =
        ((bytes[dataStart] ?? 0) << 24) |
        ((bytes[dataStart + 1] ?? 0) << 16) |
        ((bytes[dataStart + 2] ?? 0) << 8) |
        (bytes[dataStart + 3] ?? 0);
      height =
        ((bytes[dataStart + 4] ?? 0) << 24) |
        ((bytes[dataStart + 5] ?? 0) << 16) |
        ((bytes[dataStart + 6] ?? 0) << 8) |
        (bytes[dataStart + 7] ?? 0);
      bitDepth = bytes[dataStart + 8] ?? 8;
      colorType = bytes[dataStart + 9] ?? 6;
      interlace = bytes[dataStart + 12] ?? 0;
    } else if (type === 'IDAT') {
      for (let i = 0; i < len; i += 1) idat.push(bytes[dataStart + i] ?? 0);
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
  }
  if (bitDepth !== 8 || interlace !== 0 || width === 0) {
    throw new Error('Unsupported PNG format.');
  }
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (channels === 0) throw new Error('Unsupported PNG color type.');
  const raw = inflateRaw(new Uint8Array(idat).subarray(2));
  const stride = width * channels;
  let prev: Uint8Array | null = null;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart] ?? 0;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rowStart + 1 + x] ?? 0;
      const a = x >= channels ? row[x - channels] ?? 0 : 0;
      const b = prev ? prev[x] ?? 0 : 0;
      const c = prev && x >= channels ? prev[x - channels] ?? 0 : 0;
      let v = rawByte;
      switch (filter) {
        case 1:
          v = (rawByte + a) & 0xff;
          break;
        case 2:
          v = (rawByte + b) & 0xff;
          break;
        case 3:
          v = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          v = (rawByte + paeth(a, b, c)) & 0xff;
          break;
        default:
          v = rawByte;
      }
      row[x] = v;
    }
    const rgba = new Uint8Array(width * 4);
    for (let x = 0; x < width; x += 1) {
      const si = x * channels;
      const di = x * 4;
      rgba[di] = row[si] ?? 0;
      rgba[di + 1] = channels > 1 ? row[si + 1] ?? 0 : row[si] ?? 0;
      rgba[di + 2] = channels > 2 ? row[si + 2] ?? 0 : row[si] ?? 0;
      rgba[di + 3] = channels === 4 ? row[si + 3] ?? 255 : 255;
    }
    onRow(y, rgba);
    prev = row;
  }
  return { width, height, channels };
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

/**
 * Streaming PNG encoder: feed RGBA rows top to bottom. Rows are framed
 * (filter byte 0) into a zlib stream of stored DEFLATE blocks carried in
 * IDAT chunks, so a strip thousands of pixels tall never sits in memory.
 * The zlib Adler-32 is emitted as the last IDAT data before IEND.
 */
export class PngStreamWriter {
  private sink: ByteSink;
  private width: number;
  private adler = 1;
  private pending: number[] = [];
  private finished = false;

  constructor(sink: ByteSink, width: number, height: number) {
    this.sink = sink;
    this.width = width;
    sink.write(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const ihdr = new Uint8Array(13);
    ihdr.set(u32be(width), 0);
    ihdr.set(u32be(height), 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    this.writeChunk('IHDR', ihdr);
    // The zlib header (0x78 0x01) precedes the first DEFLATE block; it is
    // prepended in emitBlock, NOT part of the stored-block payload.
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

  private zlibStarted = false;

  private emitBlock(final: boolean): void {
    const take = Math.min(65535, this.pending.length);
    const block = new Uint8Array(5 + take);
    block[0] = final ? 1 : 0; // BFINAL, BTYPE=00, padded to byte boundary
    block[1] = take & 0xff;
    block[2] = (take >> 8) & 0xff;
    const nlen = 0xffff - take;
    block[3] = nlen & 0xff;
    block[4] = (nlen >> 8) & 0xff;
    block.set(this.pending.slice(0, take), 5);
    this.pending = this.pending.slice(take);
    if (!this.zlibStarted) {
      this.zlibStarted = true;
      const withHeader = new Uint8Array(block.length + 2);
      withHeader[0] = 0x78; // zlib CMF: deflate, 32K window
      withHeader[1] = 0x01; // zlib FLG: no compression, check bits valid
      withHeader.set(block, 2);
      this.writeChunk('IDAT', withHeader);
    } else {
      this.writeChunk('IDAT', block);
    }
  }

  writeRow(rgbaRow: Uint8Array): void {
    if (this.finished) throw new Error('PNG already finished.');
    const framed = new Uint8Array(this.width * 4 + 1);
    framed[0] = 0; // filter: none
    framed.set(rgbaRow.subarray(0, this.width * 4), 1);
    this.adler = adler32Update(this.adler, framed);
    for (let i = 0; i < framed.length; i += 1) this.pending.push(framed[i] ?? 0);
    while (this.pending.length > 65535) this.emitBlock(false);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    // One last stored block carries BFINAL (possibly empty), then the
    // Adler-32 closes the zlib stream as final IDAT data, then IEND.
    this.emitBlock(true);
    this.writeChunk('IDAT', u32be(this.adler));
    this.writeChunk('IEND', new Uint8Array(0));
  }
}
