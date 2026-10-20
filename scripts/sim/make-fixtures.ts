// Generates simulator test fixtures (run with: node --experimental-strip-types).
//   out/frames/frame-0000N.png + index.json — a fake screen recording,
//     exactly what targets/broadcast writes into BroadcastInbox
//   out/shots/shot-N.png — three overlapping screenshots (stitch from photos)
//   out/photo.png        — one photo (convert / resize)
//   out/doc.pdf          — a 3-page PDF (PDF tools)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import { PngStreamWriter } from '../../src/lib/deflate.ts';

const out = process.argv[2] ?? 'sim-fixtures';
const W = 1170;
const H = 2532;
const STATUS = 140;
const NAV = 150;
const TAB = 250;

function writePng(path: string, width: number, height: number, row: (y: number, buf: Uint8Array) => void) {
  const chunks: Uint8Array[] = [];
  const w = new PngStreamWriter({ write: (b) => chunks.push(b.slice()) }, width, height);
  const buf = new Uint8Array(width * 4);
  for (let y = 0; y < height; y += 1) {
    row(y, buf);
    w.writeRow(buf);
  }
  w.finish();
  writeFileSync(path, Buffer.concat(chunks));
}

function pagePixel(x: number, py: number): [number, number, number] {
  const block = Math.floor(py / 64);
  const inText = (py % 64) > 18 && (py % 64) < 46;
  const word = Math.floor(x / 90 + block * 3) % 5 !== 0;
  if (x > 60 && x < W - 120 && inText && word) {
    const v = 30 + ((block * 53) % 120);
    return [v, v, v + 25];
  }
  if (block % 17 === 5 && x > 60 && x < W - 120) {
    return [(x + py) & 255, (py * 3) & 255, 160];
  }
  return [255, 255, 255];
}

function screenRow(scroll: number, clock: number, y: number, buf: Uint8Array) {
  for (let x = 0; x < W; x += 1) {
    let c: [number, number, number];
    if (y < STATUS) c = x > 80 && x < 260 && y > 50 && y < 100 ? [clock * 40 & 255, 20, 20] : [248, 248, 248];
    else if (y < STATUS + NAV) c = [28, 110, 220];
    else if (y >= H - TAB) c = (x % 234) < 117 && y > H - TAB + 50 && y < H - TAB + 130 ? [120, 120, 128] : [242, 242, 247];
    else c = pagePixel(x, scroll + y - STATUS - NAV);
    const i = x * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = 255;
  }
}

/**
 * Copy of a PNG with the XMP packet iOS writes into real screenshots
 * (exif:UserComment = "Screenshot"), which is how Photos files an image
 * under the Screenshots subtype. Inserted as an iTXt chunk after IHDR.
 */
function asScreenshot(png: Buffer): Buffer {
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/">' +
    '<exif:UserComment>Screenshot</exif:UserComment></rdf:Description></rdf:RDF></x:xmpmeta>';
  const data = Buffer.concat([
    Buffer.from('XML:com.adobe.xmp', 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]), // null, compression flag, method, empty lang, empty keyword
    Buffer.from(xmp, 'utf8'),
  ]);
  const type = Buffer.from('iTXt', 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), len, type, data, crc, png.subarray(ihdrEnd)]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(join(out, 'frames'), { recursive: true });
mkdirSync(join(out, 'session'), { recursive: true });
mkdirSync(join(out, 'shots'), { recursive: true });

// A recording: steady scroll with one paused (duplicate) frame.
const scrolls = [0, 700, 1400, 1400, 2100, 2800, 3500, 4200];
const items = scrolls.map((s, i) => {
  const file = `frame-${String(i).padStart(5, '0')}.png`;
  writePng(join(out, 'frames', file), W, H, (y, b) => screenRow(s, i, y, b));
  return { file, kind: 'frame', tool: 'stitch', width: W, height: H, at: Date.now() + i };
});
writeFileSync(join(out, 'frames', 'index.json'), JSON.stringify({ items, finished: true }));

[0, 900, 1800].forEach((s, i) => {
  const path = join(out, 'shots', `shot-${i + 1}.png`);
  writePng(path, W, H, (y, b) => screenRow(s, i, y, b));
  writeFileSync(join(out, 'session', `shot-${i + 1}.png`), asScreenshot(readFileSync(path)));
});

writePng(join(out, 'photo.png'), 2400, 1800, (y, b) => {
  for (let x = 0; x < 2400; x += 1) {
    const i = x * 4;
    b[i] = (x / 10) & 255;
    b[i + 1] = (y / 8) & 255;
    b[i + 2] = ((x + y) / 12) & 255;
    b[i + 3] = 255;
  }
});

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let p = 1; p <= 3; p += 1) {
  const page = pdf.addPage([612, 792]);
  page.drawText(`Everytool fixture page ${p}`, { x: 72, y: 700, size: 24, font });
}
writeFileSync(join(out, 'doc.pdf'), await pdf.save());
console.log(`fixtures written to ${out}`);
