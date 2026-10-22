import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';

import {
  INK_BLACK,
  INK_BLUE,
  classifyField,
  clampRect,
  deleteMark,
  deleteSign,
  fitInto,
  flattenSignFill,
  inputFor,
  moveMark,
  placeMark,
  planSignFill,
  readSignFields,
  resizeMark,
  saveSign,
  signedFilename,
  smoothStroke,
  todayLabel,
  undoInk,
  type PageMark,
  type SavedSign,
} from '../src/lib/pdfSign.ts';

/** Inflate streams and turn PDF hex text (`<48656C6C6F>`) back into letters. */
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

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Agreement', { x: 72, y: 740, size: 18, font });
  const form = doc.getForm();

  const name = form.createTextField('Name');
  name.addToPage(page, { x: 72, y: 680, width: 220, height: 22, borderWidth: 0 });

  const date = form.createTextField('Date');
  date.addToPage(page, { x: 320, y: 680, width: 140, height: 22, borderWidth: 0 });

  const city = form.createTextField('City');
  city.setText('Paris');
  city.addToPage(page, { x: 72, y: 640, width: 220, height: 22, borderWidth: 0 });

  const notes = form.createTextField('Notes');
  notes.enableReadOnly();
  notes.addToPage(page, { x: 72, y: 600, width: 220, height: 22, borderWidth: 0 });

  const agree = form.createCheckBox('Agree');
  agree.addToPage(page, { x: 72, y: 560, width: 16, height: 16, borderWidth: 1 });

  const signature = form.createTextField('Signature');
  signature.addToPage(page, { x: 72, y: 470, width: 220, height: 56, borderWidth: 0 });
  signature.acroField.dict.set(PDFName.of('FT'), PDFName.of('Sig'));

  return doc.save();
}

test('sign fields: text, date, checkbox, and signature, and existing text stays put', async () => {
  const bytes = await formPdf();
  const fields = await readSignFields(bytes);
  const byName = Object.fromEntries(fields.map((field) => [field.name, field]));

  assert.equal(byName.Name?.kind, 'text');
  assert.equal(byName.Name?.input, 'keyboard');
  assert.equal(byName.Name?.fillable, true);
  assert.equal(byName.Name?.rect.x, 72);
  assert.equal(byName.Name?.rect.width, 220);

  assert.equal(byName.Date?.kind, 'date');
  assert.equal(byName.Date?.input, 'date');
  assert.equal(byName.Date?.fillable, true);

  assert.equal(byName.Agree?.kind, 'checkbox');
  assert.equal(byName.Agree?.input, 'checkbox');
  assert.equal(byName.Agree?.fillable, true);

  assert.equal(byName.Signature?.kind, 'signature');
  assert.equal(byName.Signature?.input, 'signature');
  assert.equal(byName.Signature?.fillable, true);

  assert.equal(byName.City?.empty, false);
  assert.equal(byName.City?.fillable, false);
  assert.equal(byName.Notes?.readOnly, true);
  assert.equal(byName.Notes?.fillable, false);

  assert.equal(
    fields.some((field) => field.name === 'Agreement'),
    false,
  );
});

test('sign fields: only empty fields are written, and the original file is unchanged', async () => {
  const bytes = await formPdf();
  const before = bytes.slice();
  const fields = await readSignFields(bytes);
  const plan = planSignFill(
    fields,
    [
      { name: 'Name', text: 'Ada Lovelace' },
      { name: 'Date', text: todayLabel(new Date(2026, 9, 22)) },
      { name: 'City', text: 'HACKED' },
      { name: 'Notes', text: 'HACKED' },
      { name: 'Agree', checked: true },
      {
        name: 'Signature',
        signature: { mode: 'typed', text: 'Ada Lovelace', color: INK_BLUE, strokes: [] },
      },
    ],
    [
      {
        id: 'nope',
        page: 0,
        kind: 'text',
        rect: { x: 10, y: 10, width: 40, height: 12 },
        text: 'FREE',
        color: INK_BLACK,
        strokes: [],
      },
    ],
    'lease.pdf',
  );

  assert.equal(plan.filename, 'lease-signed.pdf');
  assert.deepEqual(
    plan.skipped.map((item) => item.reason).sort(),
    ['filled', 'read-only'],
  );
  assert.equal(plan.marks.length, 0);
  assert.equal(
    plan.fields.some((field) => field.name === 'City'),
    false,
  );

  const out = await flattenSignFill(bytes, plan);
  assert.equal(Buffer.compare(bytes, before), 0);
  const latin = await pdfPlain(out);
  assert.equal(latin.includes('Agreement'), true);
  assert.equal(latin.includes('Ada Lovelace'), true);
  assert.equal(latin.includes('Oct 22, 2026'), true);
  assert.equal(latin.includes('Paris'), true);
  assert.equal(latin.includes('HACKED'), false);
  assert.equal(latin.includes('FREE'), false);

  const again = await readSignFields(out);
  assert.equal(
    again.some((field) => field.fillable),
    false,
  );
});

test('sign fields: a scan with no form takes marks, and a form does not', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 400]);
  page.drawText('Scan', { x: 24, y: 360, size: 16, font });
  const bytes = await doc.save();
  const fields = await readSignFields(bytes);
  assert.equal(fields.length, 0);

  const placed = placeMark({
    fields,
    page: 0,
    pageWidth: 300,
    pageHeight: 400,
    x: 20,
    y: 20,
    kind: 'text',
    text: 'Hello',
    id: 't1',
  });
  assert.ok(placed);
  assert.equal(placed.rect.x, 0);
  assert.equal(placed.rect.y, 8);

  const moved = moveMark(placed, 40, 80, 300, 400);
  const grown = resizeMark(moved, 400, 10, 300, 400);
  assert.equal(grown.rect.width, 300);
  assert.equal(grown.rect.x, 0);
  assert.equal(deleteMark([grown], 't1').length, 0);

  const signature = placeMark({
    fields,
    page: 0,
    pageWidth: 300,
    pageHeight: 400,
    x: 150,
    y: 200,
    kind: 'signature',
    color: INK_BLACK,
    strokes: [
      [
        { x: 0.1, y: 0.5 },
        { x: 0.5, y: 0.8 },
        { x: 0.9, y: 0.4 },
      ],
    ],
    id: 's1',
  });
  assert.ok(signature);
  const plan = planSignFill(fields, [], [grown, signature], 'scan.PDF');
  assert.equal(plan.filename, 'scan-signed.pdf');
  const out = await flattenSignFill(bytes, plan);
  const latin = await pdfPlain(out);
  assert.equal(latin.includes('Hello'), true);
  assert.equal(latin.includes('Scan'), true);

  const form = await readSignFields(await formPdf());
  assert.equal(
    placeMark({
      fields: form,
      page: 0,
      pageWidth: 612,
      pageHeight: 792,
      x: 100,
      y: 100,
      kind: 'text',
      id: 'x',
    }),
    null,
  );
});

test('sign pad: smooth, undo, colors, saved signatures, and the fitted rect', () => {
  assert.equal(classifyField('Sig', 'Anything'), 'signature');
  assert.equal(classifyField('Tx', 'Date signed'), 'date');
  assert.equal(classifyField('Tx', 'Initials'), 'signature');
  assert.equal(classifyField('Tx', 'Name'), 'text');
  assert.equal(classifyField('Btn', 'Choice', 'radio'), null);
  assert.equal(inputFor('checkbox'), 'checkbox');
  assert.equal(todayLabel(new Date(2026, 9, 22)), 'Oct 22, 2026');
  assert.equal(signedFilename(''), 'document-signed.pdf');
  assert.equal(signedFilename('a/b?.pdf'), 'ab-signed.pdf');

  const smooth = smoothStroke([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ]);
  assert.deepEqual(smooth[0], { x: 0, y: 0 });
  assert.deepEqual(smooth[smooth.length - 1], { x: 20, y: 0 });
  assert.equal(smooth.length > 3, true);
  assert.deepEqual(undoInk([[1], [2], [3]]), [[1], [2]]);
  assert.deepEqual(undoInk([]), []);

  const box = fitInto({ x: 10, y: 20, width: 200, height: 80 }, 4);
  assert.equal(box.width, 200);
  assert.equal(box.height, 50);
  assert.equal(box.x, 10);
  assert.equal(box.y, 35);

  const tall = fitInto({ x: 0, y: 0, width: 200, height: 40 }, 0.5);
  assert.equal(tall.height, 40);
  assert.equal(tall.width, 20);
  assert.equal(tall.x, 90);

  const saved: SavedSign[] = [];
  let next = saved;
  for (let i = 0; i < 22; i += 1) {
    next = saveSign(next, {
      id: `s${i}`,
      role: i % 2 === 0 ? 'signature' : 'initials',
      mode: 'typed',
      label: `N${i}`,
      color: i % 2 === 0 ? INK_BLACK : INK_BLUE,
      strokes: [],
      createdAt: i,
    });
  }
  assert.equal(next.length, 20);
  assert.equal(next[0]?.id, 's21');
  assert.equal(next.some((item) => item.id === 's0'), false);
  assert.equal(deleteSign(next, 's21').some((item) => item.id === 's21'), false);

  const clamped = clampRect({ x: -10, y: 5, width: 4, height: 900 }, 100, 80);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.width >= 8, true);
  assert.equal(clamped.height, 80);
});

test('sign marks: resize and move keep the mark on the page', () => {
  const mark: PageMark = {
    id: 'm',
    page: 0,
    kind: 'date',
    rect: { x: 10, y: 10, width: 40, height: 16 },
    text: 'Oct 22, 2026',
    color: INK_BLACK,
    strokes: [],
  };
  const moved = moveMark(mark, 1000, -1000, 200, 100);
  assert.equal(moved.rect.x, 160);
  assert.equal(moved.rect.y, 0);
  assert.equal(moved.text, mark.text);
});
