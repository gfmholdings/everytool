import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  compressPdfBytes,
  extractPdfBytes,
  mergePdfBytes,
  pageCountOf,
} from '../src/lib/pdfCore.ts';
import { specToIndices } from '../src/lib/pages.ts';

const JPG = new Uint8Array(readFileSync(new URL('./fixtures/photo.jpg', import.meta.url)));
const PNG = new Uint8Array(readFileSync(new URL('./fixtures/tiny.png', import.meta.url)));

/** A PDF whose page i says "P<i>" and is (500 + i) points wide. */
async function labeled(n: number, prefix = 'P', opts = { objectStreams: false }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i += 1) {
    const page = doc.addPage([500 + i, 700]);
    page.drawText(`${prefix}${i}`, { x: 40, y: 600, size: 24, font });
    for (let l = 0; l < 30; l += 1) {
      page.drawText(`line ${l} of ${prefix}${i} lorem ipsum dolor sit amet`, { x: 40, y: 560 - l * 16, size: 10, font });
    }
  }
  return doc.save({ useObjectStreams: opts.objectStreams });
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

test('pdf merge: PDFs and photos in list order, a page per photo', async () => {
  const a = await labeled(2, 'A');
  const b = await labeled(3, 'B');
  const out = await mergePdfBytes([
    { kind: 'pdf', bytes: a },
    { kind: 'image', bytes: JPG },
    { kind: 'pdf', bytes: b },
    { kind: 'image', bytes: PNG },
  ]);
  assert.equal(out.pages, 2 + 1 + 3 + 1);
  assert.equal(await pageCountOf(out.bytes), 7);
  // A1 A2 | photo 400 wide | B1 B2 B3 | png 40 wide
  assert.deepEqual(await widths(out.bytes), [501, 502, 400, 501, 502, 503, 40]);
});

test('pdf merge: rejects nothing-to-merge and non-images', async () => {
  await assert.rejects(mergePdfBytes([]), /at least one/);
  await assert.rejects(
    mergePdfBytes([{ kind: 'image', bytes: new Uint8Array([1, 2, 3, 4, 5]) }]),
    /JPEG or PNG/,
  );
});

test('pdf split: keeps the asked pages in order, ignores out-of-range', async () => {
  const src = await labeled(6);
  const out = await extractPdfBytes(src, specToIndices('5, 1-2, 9', 6));
  assert.equal(out.pages, 3);
  assert.deepEqual(await widths(out.bytes), [501, 502, 505]);
  await assert.rejects(extractPdfBytes(src, [20, 30]), /None of those pages/);
});

test('pdf compress: structure-heavy PDF shrinks a lot, pages intact', async () => {
  const src = await labeled(30);
  const out = await compressPdfBytes(src);
  assert.equal(out.shrunk, true);
  assert.equal(out.pages, 30);
  assert.ok(out.bytes.length < src.length * 0.7, `${out.bytes.length} vs ${src.length}`);
  assert.deepEqual(await widths(out.bytes), await widths(src));
});

test('pdf compress: unused leftover objects are dropped', async () => {
  const doc = await PDFDocument.create();
  await doc.embedJpg(JPG); // embedded but never drawn (left over from an edit)
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('hello', { x: 50, y: 700, font });
  const src = await doc.save({ useObjectStreams: false });
  const out = await compressPdfBytes(src);
  assert.equal(out.shrunk, true);
  assert.ok(out.bytes.length < src.length / 5, `${out.bytes.length} vs ${src.length}`);
});

test('pdf compress: never hands back a bigger file', async () => {
  const already = await labeled(3, 'C', { objectStreams: true });
  const out = await compressPdfBytes(already);
  assert.ok(out.bytes.length <= already.length);
  assert.equal(out.pages, 3);
});

test('pdf compress: photo-heavy PDFs barely change (the UI says so)', async () => {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(JPG);
  for (let i = 0; i < 5; i += 1) {
    doc.addPage([400, 300]).drawImage(img, { x: 0, y: 0, width: 400, height: 300 });
  }
  const src = await doc.save({ useObjectStreams: false });
  const out = await compressPdfBytes(src);
  assert.ok(out.bytes.length > src.length * 0.9);
  assert.equal(out.pages, 5);
});

test('pdf compress: form fields survive', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const field = doc.getForm().createTextField('customer.name');
  field.setText('Ada');
  field.addToPage(page, { x: 50, y: 600, width: 200, height: 24 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let l = 0; l < 40; l += 1) page.drawText(`filler ${l}`, { x: 40, y: 560 - l * 12, size: 9, font });
  const src = await doc.save({ useObjectStreams: false });
  const out = await compressPdfBytes(src);
  const reread = await PDFDocument.load(out.bytes);
  assert.equal(reread.getForm().getTextField('customer.name').getText(), 'Ada');
});

test('pdf: garbage input is rejected, not crashed on', async () => {
  await assert.rejects(pageCountOf(new Uint8Array([1, 2, 3])));
});
