import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts } from 'pdf-lib';

import {
  COMPRESS_RASTERIZES_PAGES,
  compressPdfBytes,
  compressPdfToTarget,
  extractPdfBytes,
  mergePdfBytes,
  pageCountOf,
  readPdfStructure,
  shrinkPdfImages,
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


const SMALL = new Uint8Array(readFileSync(new URL('./fixtures/photo-small.jpg', import.meta.url)));

async function photoPdf(n: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1) {
    const img = await doc.embedJpg(JPG); // a separate copy per page, like scanned PDFs
    const page = doc.addPage([400, 340]);
    page.drawImage(img, { x: 0, y: 40, width: 400, height: 300 });
    page.drawText(`caption ${i + 1}`, { x: 10, y: 10, size: 12, font });
  }
  return doc.save();
}

test('pdf shrink photos: JPEGs are replaced, PDF stays valid, much smaller', async () => {
  const src = await photoPdf(4);
  const seen: [number, number][] = [];
  const out = await shrinkPdfImages(src, async (_jpeg, w, h) => {
    seen.push([w, h]);
    return { bytes: SMALL, width: 200, height: 150 };
  });
  assert.equal(out.images, 4);
  assert.equal(out.replaced, 4);
  assert.equal(out.shrunk, true);
  assert.deepEqual(seen[0], [400, 300]);
  assert.ok(out.bytes.length < src.length / 3, `${out.bytes.length} vs ${src.length}`);
  const doc = await PDFDocument.load(out.bytes);
  assert.equal(doc.getPageCount(), 4);
  // page geometry unchanged: images are drawn at the same size, just fewer pixels
  assert.deepEqual(doc.getPages().map((p) => Math.round(p.getWidth())), [400, 400, 400, 400]);
  let imagesFound = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      imagesFound += 1;
      assert.equal(obj.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), 200);
      assert.equal(obj.contents.length, SMALL.length);
    }
  }
  assert.equal(imagesFound, 4);
});

test('pdf shrink photos: a re-encode that is not smaller keeps the original', async () => {
  const src = await photoPdf(1);
  const out = await shrinkPdfImages(src, async (jpeg, w, h) => ({ bytes: jpeg, width: w, height: h }));
  assert.equal(out.shrunk, false);
  assert.equal(out.bytes, src);
});

test('pdf shrink photos: text-only PDFs and failing encoders are safe', async () => {
  const text = await labeled(2);
  const out = await shrinkPdfImages(text, async () => {
    throw new Error('boom');
  });
  assert.equal(out.images, 0);
  assert.equal(out.shrunk, false);
  const photos = await photoPdf(2);
  const failed = await shrinkPdfImages(photos, async () => {
    throw new Error('decoder failed');
  });
  assert.equal(failed.replaced, 0);
  assert.equal(await pageCountOf(failed.bytes), 2);
});

/** Text, a link, bookmarks, a form, a signature, and two copies of one photo. */
async function structuredPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Lease');
  doc.setAuthor('Ada Lovelace');
  doc.setSubject('Service agreement');
  doc.setKeywords(['private']);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page1 = doc.addPage([500, 700]);
  const page2 = doc.addPage([640, 800]);
  page1.drawText('Alpha page', { x: 48, y: 640, size: 18, font });
  page2.drawText('Beta page', { x: 48, y: 740, size: 18, font });
  const photo = await doc.embedJpg(JPG);
  const copy = await doc.embedJpg(JPG);
  page1.drawImage(photo, { x: 48, y: 300, width: 200, height: 150 });
  page2.drawImage(copy, { x: 48, y: 400, width: 200, height: 150 });
  await doc.embedJpg(JPG);

  const form = doc.getForm();
  const name = form.createTextField('Name');
  name.setText('Ada');
  name.addToPage(page1, { x: 48, y: 240, width: 180, height: 22, borderWidth: 0 });
  const agree = form.createCheckBox('Agree');
  agree.check();
  agree.addToPage(page1, { x: 48, y: 200, width: 16, height: 16, borderWidth: 1 });
  const signature = form.createTextField('Signature');
  signature.addToPage(page2, { x: 48, y: 200, width: 180, height: 40, borderWidth: 0 });
  signature.acroField.dict.set(PDFName.of('FT'), PDFName.of('Sig'));

  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const outlines = ctx.obj({ Type: 'Outlines' });
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  const items = [
    { title: 'Alpha', page: page1.ref },
    { title: 'Beta', page: page2.ref },
  ];
  const refs = items.map(() => ctx.nextRef());
  items.forEach((item, index) => {
    const dict = ctx.obj({
      Title: PDFHexString.fromText(item.title),
      Parent: outlinesRef,
      Dest: [item.page, PDFName.of('Fit')],
    });
    if (index > 0) dict.set(PDFName.of('Prev'), refs[index - 1]!);
    if (index < items.length - 1) dict.set(PDFName.of('Next'), refs[index + 1]!);
    ctx.assign(refs[index]!, dict);
  });
  outlines.set(PDFName.of('First'), refs[0]!);
  outlines.set(PDFName.of('Last'), refs[1]!);
  outlines.set(PDFName.of('Count'), PDFNumber.of(items.length));

  const link = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [48, 620, 180, 660],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/lease') },
    }),
  );
  const annots = page1.node.Annots() ?? ctx.obj([]);
  if (!page1.node.Annots()) page1.node.set(PDFName.of('Annots'), annots);
  annots.push(link);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

test('pdf compress keeps text, pages, outline, and form fields', async () => {
  assert.equal(COMPRESS_RASTERIZES_PAGES, false);
  const src = await structuredPdf();
  const before = await readPdfStructure(src);
  assert.equal(before.pageCount, 2);
  assert.match(before.text, /Alpha page/);
  assert.match(before.text, /Beta page/);
  assert.deepEqual(before.outline, ['Alpha', 'Beta']);
  assert.deepEqual(
    before.fields.map((field) => field.name),
    ['Name', 'Agree', 'Signature'],
  );
  assert.equal(before.fields[0]!.value, 'Ada');
  assert.equal(before.fields[1]!.value, 'Yes');
  assert.deepEqual(before.signatures, ['Signature']);
  assert.deepEqual(before.links, ['https://example.com/lease']);
  assert.equal(before.metadata.title, 'Lease');
  assert.equal(before.metadata.author, 'Ada Lovelace');

  const plain = await compressPdfBytes(src);
  assert.deepEqual(await readPdfStructure(plain.bytes), before);
  assert.ok(plain.bytes.length < src.length);

  const shrunk = await shrinkPdfImages(src, async () => ({ bytes: SMALL, width: 200, height: 150 }));
  assert.equal(shrunk.shrunk, true);
  assert.deepEqual(await readPdfStructure(shrunk.bytes), before);

  let calls = 0;
  const fitted = await compressPdfToTarget(
    src,
    30_000,
    [
      { dpi: 300, quality: 0.85, maxLongSide: 3300 },
      { dpi: 150, quality: 0.72, maxLongSide: 1650 },
    ],
    async (jpeg, width, height, step) => {
      calls += 1;
      if (step.dpi > 200) return { bytes: jpeg, width, height };
      return { bytes: SMALL, width: 200, height: 150 };
    },
  );
  assert.equal(fitted.action, 'compress');
  assert.equal(fitted.rasterized, false);
  assert.equal(fitted.structure, 'kept');
  assert.equal(fitted.unmet, false);
  assert.ok(fitted.after <= 30_000, String(fitted.after));
  assert.equal(calls, 6);
  assert.match(fitted.message, /text is unchanged/);
  assert.deepEqual(await readPdfStructure(fitted.bytes), before);

  const stuck = await compressPdfToTarget(src, 500, [{ dpi: 72, quality: 0.4, maxLongSide: 792 }], async () => ({
    bytes: SMALL,
    width: 200,
    height: 150,
  }));
  assert.equal(stuck.action, 'smallest');
  assert.equal(stuck.unmet, true);
  assert.equal(stuck.rasterized, false);
  assert.ok(stuck.after > 500);
  assert.ok(stuck.after < src.length);
  assert.match(stuck.message, /Smallest is/);
  assert.match(stuck.message, /text is unchanged/);
  assert.deepEqual(await readPdfStructure(stuck.bytes), before);

  const quiet = await labeled(1);
  const left = await compressPdfToTarget(quiet, 5 * 1024 * 1024, [], async () => {
    throw new Error('measure');
  });
  assert.equal(left.action, 'noop');
  assert.equal(left.bytes, quiet);
  assert.deepEqual(await readPdfStructure(left.bytes), await readPdfStructure(quiet));

  const stripped = await compressPdfToTarget(
    src,
    30_000,
    [{ dpi: 72, quality: 0.4, maxLongSide: 792 }],
    async () => ({ bytes: SMALL, width: 200, height: 150 }),
    { stripPrivacy: true },
  );
  const privateView = await readPdfStructure(stripped.bytes);
  assert.equal(privateView.metadata.author, '');
  assert.equal(privateView.metadata.keywords, '');
  assert.equal(privateView.metadata.title, 'Lease');
  assert.equal(privateView.text, before.text);
  assert.deepEqual(privateView.outline, before.outline);
  assert.deepEqual(privateView.fields, before.fields);
  assert.deepEqual(privateView.pages, before.pages);
  assert.equal(privateView.pageCount, before.pageCount);

  await assert.rejects(compressPdfToTarget(new Uint8Array(), 100, [], async () => null), /empty/);
  await assert.rejects(compressPdfToTarget(src, 0, [], async () => null), /target size/);
});
