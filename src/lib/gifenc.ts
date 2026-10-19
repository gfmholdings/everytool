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
  bytes.push(...gifPalette());
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
