import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import { parseSizeTarget, SIZE_CHIPS } from '../src/lib/resizePlan.ts';

import {
  COMPRESS_PRESETS,
  OFFICE_TO_PDF,
  PAGE_POINTS,
  PDF_HUB,
  PROTECT_ENGINE,
  SCAN_TO_PDF,
  addPageNumbers,
  exportDestinations,
  extractLiteralText,
  fitImageRect,
  imagesToPdfBytes,
  keptPages,
  literalsFromContent,
  ocrPlainText,
  pageFrame,
  pdfIsEncrypted,
  plainTextToRtf,
  PDF_DPI_LADDER,
  PDF_QUALITY_FLOOR,
  PDF_QUALITY_LADDER,
  PDF_TARGET_CHIPS,
  parsePdfTarget,
  pdfLongSideAtDpi,
  pdfTargetSteps,
  planCompressTarget,
  planPdfTarget,
  protectRequest,
  rasterPixels,
  rasterPlan,
  removePdfPages,
  reorderPages,
  reorderPdfBytes,
  rotatePdfBytes,
  searchablePdfFromOcr,
  sizeChange,
  splitGroups,
  splitPdfBytes,
  unlockRequest,
  watermarkOpacity,
  watermarkPdfBytes,
} from '../src/lib/pdfTools.ts';

const JPG = new Uint8Array(readFileSync(new URL('./fixtures/photo.jpg', import.meta.url)));
const PNG = new Uint8Array(readFileSync(new URL('./fixtures/tiny.png', import.meta.url)));

async function labeled(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i += 1) {
    const page = doc.addPage([500 + i, 700]);
    page.drawText(`P${i}`, { x: 40, y: 600, size: 24, font });
  }
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

async function angles(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getRotation().angle);
}

test('pdf hub: the current screen, the new work, and what cannot be done offline', () => {
  const byId = Object.fromEntries(PDF_HUB.map((item) => [item.id, item.status]));
  assert.equal(byId.merge, 'in-app');
  assert.equal(byId.split, 'partial');
  assert.equal(byId.compress, 'partial');
  assert.equal(byId.reorder, 'partial');
  assert.equal(byId['to-images'], 'groundwork');
  assert.equal(byId['from-images'], 'groundwork');
  assert.equal(byId.sign, 'groundwork');
  assert.equal(byId.scan, 'device');
  assert.equal(byId.protect, 'device');
  assert.equal(byId.unlock, 'device');
  assert.equal(byId.ocr, 'device');
  assert.equal(byId['any-file'], 'groundwork');
  assert.equal(byId.office, 'not-feasible');
  assert.equal(OFFICE_TO_PDF.feasible, false);
  assert.match(OFFICE_TO_PDF.reason, /docx, xlsx, or pptx/);
  assert.equal(SCAN_TO_PDF.engine, 'visionkit');
  assert.equal(PROTECT_ENGINE, 'pdfkit');
});

test('pdf to images: DPI and a page list become pixel sizes and file names', () => {
  assert.deepEqual(rasterPixels(612, 792, 300), { width: 2550, height: 3300 });
  assert.throws(() => rasterPixels(612, 792, 10), /DPI/);
  const plan = rasterPlan({
    baseName: 'lease.pdf',
    pageCount: 3,
    sizes: [
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 500, height: 400 },
    ],
    pages: [3, 1, 3],
    dpi: 150,
    format: 'png',
  });
  assert.deepEqual(
    plan.map((page) => page.filename),
    ['lease-page-03.png', 'lease-page-01.png'],
  );
  assert.equal(plan[0]!.width, Math.round((500 * 150) / 72));
  assert.deepEqual(exportDestinations('image'), ['photos', 'files', 'share']);
  assert.deepEqual(exportDestinations('pdf'), ['files', 'share']);
});

test('images to PDF: A4 contain, letter landscape, and fit keep the photo inside the margins', async () => {
  const margin = 36;
  const frame = pageFrame('a4', 'portrait', 400, 300, margin);
  assert.ok(Math.abs(frame.width - PAGE_POINTS.a4.width) < 0.01);
  const fitted = fitImageRect(frame.width, frame.height, 400, 300, margin);
  assert.ok(fitted.x >= margin - 0.01);
  assert.ok(fitted.y >= margin - 0.01);
  assert.ok(fitted.x + fitted.width <= frame.width - margin + 0.01);
  const letter = pageFrame('letter', 'landscape', 100, 100, 0);
  assert.ok(Math.abs(letter.width - PAGE_POINTS.letter.height) < 0.01);
  assert.deepEqual(pageFrame('fit', 'portrait', 40, 20, 8), { width: 56, height: 36 });

  const out = await imagesToPdfBytes([{ bytes: JPG }, { bytes: PNG }], {
    size: 'a4',
    orientation: 'portrait',
    marginPt: 36,
  });
  assert.equal(out.pages, 2);
  const doc = await PDFDocument.load(out.bytes);
  assert.ok(Math.abs(doc.getPage(0).getWidth() - PAGE_POINTS.a4.width) < 0.5);
  await assert.rejects(
    imagesToPdfBytes([{ bytes: new Uint8Array([1, 2, 3, 4]) }], {
      size: 'fit',
      orientation: 'portrait',
      marginPt: 0,
    }),
    /JPEG or PNG/,
  );
});

test('split, remove, and reorder: groups of pages, and the bytes follow that order', async () => {
  assert.deepEqual(splitGroups(5, { kind: 'every', n: 2 }), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(splitGroups(4, { kind: 'range', spec: '3, 1-2' }), [[0, 1, 2]]);
  assert.deepEqual(splitGroups(4, { kind: 'extract', pages: [4, 1, 4] }), [[3, 0]]);
  assert.deepEqual(keptPages(4, [2, 2]), [0, 2, 3]);
  assert.deepEqual(reorderPages(3, [3, 1, 2]), [2, 0, 1]);
  assert.throws(() => reorderPages(3, [1, 1, 2]), /every page/);
  assert.throws(() => splitGroups(4, { kind: 'every', n: 0 }), /every 1/);

  const src = await labeled(4);
  const before = Buffer.from(src);
  const parts = await splitPdfBytes(src, { kind: 'every', n: 3 });
  assert.deepEqual(await Promise.all(parts.map(async (part) => widths(part.bytes))), [[501, 502, 503], [504]]);
  const removed = await removePdfPages(src, [2]);
  assert.deepEqual(await widths(removed.bytes), [501, 503, 504]);
  const order = await reorderPdfBytes(src, [3, 1, 2, 4]);
  assert.deepEqual(await widths(order.bytes), [503, 501, 502, 504]);
  assert.equal(Buffer.compare(before, Buffer.from(src)), 0);
});

test('rotate and page numbers and a watermark leave the page count and grow the file', async () => {
  const src = await labeled(2);
  const turned = await rotatePdfBytes(src, [{ page: 0, quarterTurns: 1 }, { page: 1, quarterTurns: 2 }]);
  assert.deepEqual(await angles(turned.bytes), [90, 180]);
  assert.equal(turned.pages, 2);

  const numbered = await addPageNumbers(src, { spot: 'bottom-center', ofTotal: true });
  assert.equal(numbered.pages, 2);
  assert.ok(numbered.bytes.length > src.length);

  const marked = await watermarkPdfBytes(src, { text: 'DRAFT', opacity: 0.3, place: 'diagonal' });
  assert.equal(marked.pages, 2);
  assert.ok(marked.bytes.length > src.length);
  assert.equal(watermarkOpacity(2), 1);
  assert.equal(watermarkOpacity(-1), 0);
  const faded = await watermarkPdfBytes(src, {
    text: '',
    image: PNG,
    opacity: 0.4,
    place: 'center',
  });
  assert.equal(faded.pages, 2);
  await assert.rejects(watermarkPdfBytes(src, { opacity: 0.2, place: 'center' }), /text or an image/);
});

test('compress levels and a target size: high is smaller settings, the target keeps the best fit', () => {
  assert.ok(COMPRESS_PRESETS.low.quality > COMPRESS_PRESETS.medium.quality);
  assert.ok(COMPRESS_PRESETS.medium.maxLongSide > COMPRESS_PRESETS.high.maxLongSide);
  const measure = (quality: number, side: number) => Math.round(quality * side * 10);
  const easy = planCompressTarget(2400 * 10, measure);
  assert.equal(easy.unmet, false);
  assert.equal(easy.quality, 0.85);
  assert.equal(easy.maxLongSide, 2400);
  const tight = planCompressTarget(100, measure);
  assert.equal(tight.unmet, true);
  assert.equal(tight.quality, 0.38);
  assert.equal(tight.maxLongSide, 800);
  assert.deepEqual(sizeChange(2_400_000, 640_000), {
    before: 2_400_000,
    after: 640_000,
    saved: 1_760_000,
    shrunk: true,
  });
});

test('pdf target size: chips match Resize, and the loop stops at the first readable step', () => {
  assert.deepEqual(
    PDF_TARGET_CHIPS.map((chip) => chip.bytes),
    [500 * 1024, 1024 * 1024, 2 * 1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024, 20 * 1024 * 1024, 25 * 1024 * 1024],
  );
  for (const chip of PDF_TARGET_CHIPS) {
    const same = SIZE_CHIPS.find((item) => item.id === chip.id);
    assert.ok(same, chip.id);
    assert.equal(same!.bytes, chip.bytes);
    assert.equal(same!.label, chip.label);
  }
  assert.equal(parsePdfTarget('1,5', 'MB'), parseSizeTarget('1,5', 'MB'));
  assert.equal(parsePdfTarget('0', 'KB'), null);
  assert.equal(parsePdfTarget('250', 'MB'), null);
  assert.deepEqual(PDF_DPI_LADDER, [300, 150, 100, 72]);
  assert.equal(PDF_QUALITY_FLOOR, 0.4);
  assert.equal(pdfLongSideAtDpi(300), 3300);
  assert.equal(pdfLongSideAtDpi(72), 792);
  const steps = pdfTargetSteps();
  assert.equal(steps.length, PDF_DPI_LADDER.length * PDF_QUALITY_LADDER.length);
  assert.deepEqual(steps[0], { dpi: 300, quality: 0.85, maxLongSide: 3300 });
  assert.deepEqual(steps[3], { dpi: 300, quality: 0.4, maxLongSide: 3300 });
  assert.deepEqual(steps[4], { dpi: 150, quality: 0.85, maxLongSide: 1650 });
  assert.deepEqual(steps.at(-1), { dpi: 72, quality: 0.4, maxLongSide: 792 });

  const already = planPdfTarget({
    beforeBytes: 240 * 1024,
    maxBytes: 1024 * 1024,
    measure: () => {
      throw new Error('measure');
    },
  });
  assert.equal(already.action, 'noop');
  assert.equal(already.rasterized, false);
  assert.equal(already.structure, 'kept');
  assert.equal(already.after, 240 * 1024);
  assert.equal(already.text, 'kept');
  assert.match(already.message, /Already 240 KB, under 1 MB/);
  assert.match(already.message, /Left as it is/);
  assert.match(
    planPdfTarget({ beforeBytes: 1024 * 1024, maxBytes: 1024 * 1024, measure: () => 1 }).message,
    /Already 1 MB\. Left as it is/,
  );

  let calls = 0;
  const fitted = planPdfTarget({
    beforeBytes: 3 * 1024 * 1024,
    maxBytes: 500 * 1024,
    measure: (step) => {
      calls += 1;
      if (step.dpi === 150 && step.quality <= 0.72) return 400 * 1024;
      return 2 * 1024 * 1024;
    },
  });
  assert.equal(calls, 6);
  assert.equal(fitted.action, 'compress');
  assert.equal(fitted.rasterized, false);
  assert.equal(fitted.dpi, 150);
  assert.equal(fitted.quality, 0.72);
  assert.equal(fitted.maxLongSide, 1650);
  assert.equal(fitted.unmet, false);
  assert.equal(fitted.after, 400 * 1024);
  assert.match(fitted.message, /3 MB is now 400 KB/);
  assert.match(fitted.message, /text is unchanged/);

  let all = 0;
  const stuck = planPdfTarget({
    beforeBytes: 8 * 1024 * 1024,
    maxBytes: 500 * 1024,
    measure: (step) => {
      all += 1;
      return step.dpi === 72 && step.quality === 0.4 ? Math.round(1.2 * 1024 * 1024) : 3 * 1024 * 1024;
    },
  });
  assert.equal(all, steps.length);
  assert.equal(stuck.action, 'smallest');
  assert.equal(stuck.rasterized, false);
  assert.equal(stuck.structure, 'kept');
  assert.equal(stuck.unmet, true);
  assert.equal(stuck.dpi, 72);
  assert.equal(stuck.quality, 0.4);
  assert.equal(stuck.after, Math.round(1.2 * 1024 * 1024));
  assert.match(stuck.message, /Cannot get under 500 KB/);
  assert.match(stuck.message, /Smallest is 1\.2 MB/);
  assert.match(stuck.message, /text is unchanged/);

  const unsqueezable = planPdfTarget({
    beforeBytes: 4 * 1024 * 1024,
    maxBytes: 500 * 1024,
    measure: () => 5 * 1024 * 1024,
  });
  assert.equal(unsqueezable.action, 'smallest');
  assert.equal(unsqueezable.after, 4 * 1024 * 1024);
  assert.match(unsqueezable.message, /Smallest is 4 MB/);
  assert.throws(() => planPdfTarget({ beforeBytes: 100, maxBytes: 0, measure: () => 1 }), /target size/);
});

test('protect and unlock stay on PDFKit, and a normal file is not encrypted', async () => {
  assert.deepEqual(protectRequest('correct horse'), { engine: 'pdfkit', userPassword: 'correct horse' });
  assert.throws(() => protectRequest('   '), /password/);
  assert.throws(() => unlockRequest(''), /password/);
  assert.equal(unlockRequest('secret').password, 'secret');
  const src = await labeled(1);
  assert.equal(await pdfIsEncrypted(src), false);
});

test('OCR text becomes plain text, a simple RTF, and a searchable PDF', async () => {
  const text = ocrPlainText([{ text: 'Ada Lovelace' }, { text: '  ' }, { text: 'Oct 22' }]);
  assert.equal(text, 'Ada Lovelace\n\nOct 22');
  const rtf = plainTextToRtf('Line {1}\\\nLine 2');
  assert.match(rtf, /{\\rtf1/);
  assert.match(rtf, /Line \\{1\\}\\\\/);
  assert.match(rtf, /\\par/);
  const pdf = await searchablePdfFromOcr([{ text: 'Ada Lovelace', jpeg: JPG }, { text: 'Second page' }]);
  assert.equal(pdf.pages, 2);
  assert.equal(
    extractLiteralText(['(Hello) Tj (World) Tj', '(Say \\(hi\\)) Tj']),
    'Hello World\nSay (hi)',
  );
  assert.equal(literalsFromContent('(no draw)'), 'no draw');
});
