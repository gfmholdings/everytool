import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';

import {
  CONVERT_EXPORTS,
  CONVERT_ROUTE,
  CONVERT_ROUTE_LABEL,
  OFFICE_SHARE_NOTE,
  combinePdfBytes,
  convertFilesToPdf,
  describeFile,
  extensionOf,
  formatsByReliability,
  htmlRemoteUrls,
  officeShareNote,
  parseCsv,
  rtfToPlain,
  shareRoutesFor,
  webPagePlan,
} from '../src/lib/pdfConvert.ts';
import { CONVERT_OPEN_EXTENSIONS } from '../src/lib/pdfOpen.ts';

const JPG = new Uint8Array(readFileSync(new URL('./fixtures/photo.jpg', import.meta.url)));
const PNG = new Uint8Array(readFileSync(new URL('./fixtures/tiny.png', import.meta.url)));

async function pdfPlain(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(PDFName.of('Filter'));
    const flate = filter instanceof PDFName && filter.asString() === '/FlateDecode';
    const body = flate ? inflateSync(Buffer.from(obj.contents)) : obj.contents;
    const text = Buffer.from(body).toString('latin1');
    const decoded = text.replace(/<([0-9A-Fa-f\s]+)>/g, (_, raw: string) => {
      const clean = raw.replace(/\s+/g, '');
      if (clean.length < 2 || clean.length % 2 !== 0) return '';
      return Buffer.from(clean, 'hex').toString('latin1');
    });
    parts.push(decoded);
  }
  return parts.join('\n');
}

test('any file to PDF: reliable formats, and the ones the phone cannot convert', () => {
  const groups = Object.fromEntries(formatsByReliability().map((group) => [group.reliability, group.labels]));
  for (const label of ['JPEG', 'PNG', 'HEIC', 'GIF', 'TIFF', 'BMP', 'WebP', 'Plain text', 'Markdown', 'RTF', 'CSV', 'PDF']) {
    assert.ok(groups.reliable!.includes(label), label);
  }
  assert.deepEqual(groups['offline-limited'], ['HTML', 'Web archive']);
  assert.deepEqual(groups.online, ['Web page']);
  assert.deepEqual(groups['not-reliable'], ['Word', 'Excel', 'PowerPoint', 'Pages', 'Numbers', 'Keynote']);
  assert.match(describeFile('Report.docx').note, /Quick Look/);
  assert.equal(describeFile('Deck.key').reliability, 'not-reliable');
  assert.equal(describeFile('Budget.xlsx').engine, 'none');
  assert.equal(describeFile('Slides.pptx').reliability, 'not-reliable');
  assert.equal(describeFile('photo.heic').deviceRender, 'imageio');
  assert.equal(describeFile('scan.tiff').reliability, 'reliable');
  assert.equal(describeFile('notes.txt').deviceRender, 'none');
  assert.equal(describeFile('mystery.bin').formatId, 'unknown');
  assert.deepEqual(CONVERT_EXPORTS, ['files', 'share']);
});

test('HTML and a Safari link: local files stay on the phone, http has to load', () => {
  const local = '<html><body><h1>Hello</h1><img src="photo.jpg"></body></html>';
  assert.deepEqual(htmlRemoteUrls(local), []);
  assert.equal(describeFile('page.html', local).reliability, 'offline-limited');
  assert.equal(describeFile('page.html', local).deviceRender, 'wkwebview');
  const remote = '<img src="https://cdn.example/a.png"><link href="//fonts.example/a.css">';
  assert.deepEqual(htmlRemoteUrls(remote), ['https://cdn.example/a.png', '//fonts.example/a.css']);
  assert.equal(describeFile('page.html', remote).reliability, 'online');
  const page = webPagePlan('https://example.com/lease');
  assert.equal(page.offline, false);
  assert.equal(page.engine, 'wkwebview');
  assert.match(page.reason, /network/);
  assert.equal(webPagePlan('file:///Users/me/page.html').offline, true);
  assert.match(describeFile('from-safari.weblink', 'https://example.com').note, /network/);
  assert.equal(describeFile('saved.webarchive').deviceRender, 'wkwebview');
});

test('share sheet: Convert to PDF sits beside the old buttons, and Office gets the note', () => {
  assert.deepEqual(
    shareRoutesFor([{ kind: 'image', name: 'a.png' }]).map((route) => route.label),
    ['Convert', 'Resize', 'Scan QR code', 'Stitch', CONVERT_ROUTE_LABEL],
  );
  assert.equal(shareRoutesFor([{ kind: 'image', name: 'a.png' }]).at(-1)!.tool, CONVERT_ROUTE);
  assert.deepEqual(
    shareRoutesFor([
      { kind: 'image', name: 'a.png' },
      { kind: 'image', name: 'b.jpg' },
    ]).map((route) => route.tool),
    ['stitch', 'convert', CONVERT_ROUTE],
  );
  assert.deepEqual(
    shareRoutesFor([{ kind: 'text', name: 'notes.txt' }]).map((route) => route.label),
    ['Save to clipboard', CONVERT_ROUTE_LABEL],
  );
  assert.deepEqual(shareRoutesFor([{ kind: 'pdf', name: 'lease.pdf' }]), [{ tool: 'pdf', label: 'PDF tools' }]);
  assert.deepEqual(
    shareRoutesFor([{ kind: 'convert', name: 'page.html' }]),
    [{ tool: CONVERT_ROUTE, label: CONVERT_ROUTE_LABEL }],
  );
  assert.deepEqual(shareRoutesFor([{ kind: 'convert', name: 'Report.docx' }]), []);
  assert.equal(officeShareNote(['Report.docx', 'Budget.xlsx', 'Talk.key']), OFFICE_SHARE_NOTE);
  assert.equal(officeShareNote(['photo.jpg', 'Report.docx']), null);
  assert.equal(CONVERT_ROUTE_LABEL, 'Convert to PDF');

  const share = readFileSync(new URL('../targets/share/ShareViewController.swift', import.meta.url), 'utf8');
  assert.match(share, /Convert to PDF/);
  assert.match(share, /pdf-convert/);
  assert.match(share, /kind: converting \? "convert"/);
  assert.match(share, /OFFICE_SHARE_NOTE|cannot be turned into a PDF/);
  for (const ext of CONVERT_OPEN_EXTENSIONS) {
    const swift = readFileSync(
      new URL('../modules/shared-vault/ios/PdfDocumentHandler.swift', import.meta.url),
      'utf8',
    );
    assert.ok(swift.includes(`"${ext}"`), ext);
  }
});

test('text, Markdown, RTF, and CSV become pages, and a batch keeps order', async () => {
  assert.equal(
    rtfToPlain('{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0 Hello \\b world\\b0\\par Second}'),
    'Hello world\nSecond',
  );
  assert.deepEqual(parseCsv('Name,Amount\n"Ada, Lovelace",12\nBob,3\n'), [
    ['Name', 'Amount'],
    ['Ada, Lovelace', '12'],
    ['Bob', '3'],
  ]);

  const many = Array.from({ length: 200 }, () => 'This line is long enough to wrap a little and fill the page.').join('\n');
  const textPdf = await convertFilesToPdf([{ name: 'notes.txt', text: many }]);
  assert.ok(textPdf.pdf && textPdf.pdf.pages >= 2);

  const beforeJpg = Buffer.from(JPG);
  const beforePng = Buffer.from(PNG);
  const made = await PDFDocument.create();
  const font = await made.embedFont(StandardFonts.Helvetica);
  const page = made.addPage([400, 500]);
  page.drawText('LEASE', { x: 40, y: 400, size: 18, font });
  const pdfBytes = new Uint8Array(await made.save());
  const beforePdf = Buffer.from(pdfBytes);

  const batch = await convertFilesToPdf([
    { name: 'notes.txt', text: 'Hello notes' },
    { name: 'Readme.md', text: '# Title\n\nA paragraph.\n\n- One item\n\n![photo](https://example.com/a.png)' },
    { name: 'budget.csv', text: 'Name,Amount\nAda,12\n' },
    { name: 'letter.rtf', text: '{\\rtf1 Hello \\b world\\b0}' },
    { name: 'photo.jpg', image: JPG },
    { name: 'mark.png', image: PNG },
    { name: 'lease.pdf', pdf: pdfBytes },
    { name: 'shot.heic' },
    { name: 'page.html', text: '<html><body><p>Hi</p></body></html>' },
    { name: 'from-safari.weblink', text: 'https://example.com/lease' },
    { name: 'Report.docx', text: 'secret words' },
  ]);
  assert.deepEqual(beforeJpg, Buffer.from(JPG));
  assert.deepEqual(beforePng, Buffer.from(PNG));
  assert.deepEqual(beforePdf, Buffer.from(pdfBytes));
  assert.ok(batch.pdf);
  assert.equal(batch.pdf!.pages, 7);
  const plain = await pdfPlain(batch.pdf!.bytes);
  assert.match(plain, /Hello notes/);
  assert.match(plain, /Title/);
  assert.match(plain, /One item/);
  assert.match(plain, /\[image: photo\]/);
  assert.doesNotMatch(plain, /example\.com/);
  assert.match(plain, /Ada/);
  assert.match(plain, /Hello world/);
  assert.match(plain, /LEASE/);
  assert.doesNotMatch(plain, /secret words/);

  const byName = Object.fromEntries(batch.items.map((item) => [item.name, item]));
  assert.equal(byName['photo.jpg']!.included, true);
  assert.equal(byName['shot.heic']!.included, false);
  assert.equal(byName['shot.heic']!.deviceRender, 'imageio');
  assert.equal(byName['page.html']!.included, false);
  assert.equal(byName['page.html']!.deviceRender, 'wkwebview');
  assert.equal(byName['from-safari.weblink']!.reliability, 'online');
  assert.equal(byName['Report.docx']!.included, false);
  assert.match(byName['Report.docx']!.note, /Quick Look/);

  const onlyOffice = await convertFilesToPdf([{ name: 'Budget.xlsx' }]);
  assert.equal(onlyOffice.pdf, null);
  assert.equal(onlyOffice.items[0]!.included, false);

  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const wide = await PDFDocument.create();
  wide.addPage([300, 100]);
  const combined = await combinePdfBytes([await doc.save(), await wide.save()]);
  const loaded = await PDFDocument.load(combined.bytes);
  assert.deepEqual(
    loaded.getPages().map((item) => Math.round(item.getWidth())),
    [200, 300],
  );
  assert.equal(extensionOf('Folder/My File.CSV'), 'csv');
});
