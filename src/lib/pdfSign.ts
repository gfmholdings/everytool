// Sign & Fill. Pure rules over an AcroForm: which fields can be filled,
// where a signature sits, and a new flattened PDF. The original bytes are
// left alone. Nothing here is wired to a screen, and nothing talks to the
// network.
//
// Widgets are the AcroForm fields PDFKit reports (field type, rectangle,
// value, read-only). They are read with pdf-lib so the same rules can be
// tested off the device.

import {
  PDFCheckBox,
  PDFDocument,
  PDFName,
  PDFSignature,
  PDFString,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFWidgetAnnotation,
} from 'pdf-lib';

export const INK_BLACK = '#000000';
export const INK_BLUE = '#0033CC';
export const MAX_SAVED_SIGNS = 20;

export type InkColor = typeof INK_BLACK | typeof INK_BLUE;
export type FieldKind = 'text' | 'checkbox' | 'date' | 'signature';
export type FieldInput = 'keyboard' | 'checkbox' | 'date' | 'signature';
export type MarkKind = 'text' | 'name' | 'date' | 'check' | 'cross' | 'initials' | 'signature';
export type ButtonKind = 'checkbox' | 'radio' | 'push';
export type FieldTypeName = 'Tx' | 'Btn' | 'Sig' | 'Ch' | 'other';

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignField {
  name: string;
  kind: FieldKind;
  input: FieldInput;
  /** 0-based page index. */
  page: number;
  /** PDF user space. Origin is the bottom-left of the page. */
  rect: PdfRect;
  empty: boolean;
  readOnly: boolean;
  /** Empty and not read-only. A value already in the file stays as it is. */
  fillable: boolean;
}

export interface InkPoint {
  x: number;
  y: number;
}

export interface SignatureInk {
  mode: 'drawn' | 'typed';
  text: string;
  color: InkColor;
  /** Drawn strokes in 0..1 pad space. Empty when the signature is typed. */
  strokes: InkPoint[][];
}

export interface FieldFill {
  name: string;
  text?: string;
  checked?: boolean;
  signature?: SignatureInk;
}

export interface PageMark {
  id: string;
  page: number;
  kind: MarkKind;
  rect: PdfRect;
  text: string;
  color: InkColor;
  strokes: InkPoint[][];
}

export interface SavedSign {
  id: string;
  role: 'signature' | 'initials';
  mode: 'drawn' | 'typed';
  label: string;
  color: InkColor;
  strokes: InkPoint[][];
  createdAt: number;
}

export interface SignPlan {
  filename: string;
  fields: FieldFill[];
  marks: PageMark[];
  /** Fields the request named that already had a value or are read-only. */
  skipped: { name: string; reason: 'filled' | 'read-only' }[];
}

const MARK_KINDS = new Set<MarkKind>([
  'text',
  'name',
  'date',
  'check',
  'cross',
  'initials',
  'signature',
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function inputFor(kind: FieldKind): FieldInput {
  if (kind === 'checkbox') return 'checkbox';
  if (kind === 'date') return 'date';
  if (kind === 'signature') return 'signature';
  return 'keyboard';
}

/** AcroForm field type plus its name. Radio buttons and choice lists are not fill targets. */
export function classifyField(
  ft: FieldTypeName,
  name: string,
  button: ButtonKind = 'checkbox',
): FieldKind | null {
  if (ft === 'Sig') return 'signature';
  if (ft === 'Btn') return button === 'checkbox' ? 'checkbox' : null;
  if (ft !== 'Tx') return null;
  if (isDateName(name)) return 'date';
  if (isSignatureName(name)) return 'signature';
  return 'text';
}

function isDateName(name: string): boolean {
  return /(^|[^a-z])date([^a-z]|$)|(^|[^a-z])dob([^a-z]|$)/i.test(name);
}

function isSignatureName(name: string): boolean {
  return /(^|[^a-z])sign(ature)?([^a-z]|$)|(^|[^a-z])initials?([^a-z]|$)/i.test(name);
}

export function todayLabel(date: Date): string {
  const month = MONTHS[date.getMonth()] ?? 'Jan';
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

export function signedFilename(name: string): string {
  const stripped = name.trim().replace(/\.pdf$/i, '').trim();
  const clean = stripped.replace(/[\\/:*?"<>|]/g, '').trim();
  return `${clean || 'document'}-signed.pdf`;
}

export function inkColor(value: string): InkColor | null {
  if (value.toLowerCase() === INK_BLACK.toLowerCase()) return INK_BLACK;
  if (value.toLowerCase() === INK_BLUE.toLowerCase()) return INK_BLUE;
  return null;
}

/** One Chaikin pass. Endpoints stay put so the stroke still starts and ends where the finger did. */
export function smoothStroke(points: InkPoint[]): InkPoint[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: InkPoint[] = [points[0]!];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
    out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
  }
  out.push(points[points.length - 1]!);
  return out;
}

export function undoInk<T>(strokes: readonly T[]): T[] {
  return strokes.slice(0, -1);
}

/** Fit a signature of the given width÷height into a field, centered, without cropping it. */
export function fitInto(field: PdfRect, aspect: number): PdfRect {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const scale = Math.min(field.width / ratio, field.height);
  const width = scale * ratio;
  const height = scale;
  return {
    x: field.x + (field.width - width) / 2,
    y: field.y + (field.height - height) / 2,
    width,
    height,
  };
}

const DEFAULT_MARK: Record<MarkKind, { width: number; height: number }> = {
  text: { width: 160, height: 24 },
  name: { width: 180, height: 28 },
  date: { width: 130, height: 24 },
  check: { width: 22, height: 22 },
  cross: { width: 22, height: 22 },
  initials: { width: 72, height: 36 },
  signature: { width: 200, height: 64 },
};

export function clampRect(rect: PdfRect, pageWidth: number, pageHeight: number): PdfRect {
  const width = Math.min(Math.max(8, rect.width), pageWidth);
  const height = Math.min(Math.max(8, rect.height), pageHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(0, rect.x), pageWidth - width),
    y: Math.min(Math.max(0, rect.y), pageHeight - height),
  };
}

/**
 * A page with no AcroForm fields can take a new mark at a tap.
 * A page that already has fields does not: those empty fields are the only places to write.
 */
export function placeMark(input: {
  fields: readonly SignField[];
  page: number;
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  kind: MarkKind;
  text?: string;
  color?: InkColor;
  strokes?: InkPoint[][];
  id: string;
}): PageMark | null {
  if (input.fields.length > 0) return null;
  if (!MARK_KINDS.has(input.kind)) return null;
  const size = DEFAULT_MARK[input.kind];
  const rect = clampRect(
    {
      x: input.x - size.width / 2,
      y: input.y - size.height / 2,
      width: size.width,
      height: size.height,
    },
    input.pageWidth,
    input.pageHeight,
  );
  return {
    id: input.id,
    page: input.page,
    kind: input.kind,
    rect,
    text: input.text ?? '',
    color: input.color ?? INK_BLACK,
    strokes: input.strokes ?? [],
  };
}

export function moveMark(
  mark: PageMark,
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
): PageMark {
  return {
    ...mark,
    rect: clampRect({ ...mark.rect, x: mark.rect.x + dx, y: mark.rect.y + dy }, pageWidth, pageHeight),
  };
}

export function resizeMark(
  mark: PageMark,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): PageMark {
  return { ...mark, rect: clampRect({ ...mark.rect, width, height }, pageWidth, pageHeight) };
}

export function deleteMark(marks: readonly PageMark[], id: string): PageMark[] {
  return marks.filter((mark) => mark.id !== id);
}

export function saveSign(items: readonly SavedSign[], item: SavedSign): SavedSign[] {
  const rest = items.filter((saved) => saved.id !== item.id);
  return [item, ...rest].slice(0, MAX_SAVED_SIGNS);
}

export function deleteSign(items: readonly SavedSign[], id: string): SavedSign[] {
  return items.filter((saved) => saved.id !== id);
}

export function planSignFill(
  fields: readonly SignField[],
  request: readonly FieldFill[],
  marks: readonly PageMark[],
  originalName: string,
): SignPlan {
  const byName = new Map(fields.map((field) => [field.name, field]));
  const accepted: FieldFill[] = [];
  const skipped: SignPlan['skipped'] = [];
  for (const fill of request) {
    const field = byName.get(fill.name);
    if (!field) continue;
    if (field.readOnly) {
      skipped.push({ name: fill.name, reason: 'read-only' });
      continue;
    }
    if (!field.empty) {
      skipped.push({ name: fill.name, reason: 'filled' });
      continue;
    }
    accepted.push(fill);
  }
  return {
    filename: signedFilename(originalName),
    fields: accepted,
    marks: fields.length === 0 ? marks.slice() : [],
    skipped,
  };
}

function widgetPage(doc: PDFDocument, widget: PDFWidgetAnnotation): number {
  const pages = doc.getPages();
  const pref = widget.P();
  for (let i = 0; i < pages.length; i += 1) {
    if (pref && pages[i]!.ref === pref) return i;
  }
  const ref = doc.context.getObjectRef(widget.dict);
  if (!ref) return 0;
  for (let i = 0; i < pages.length; i += 1) {
    const annots = pages[i]!.node.Annots();
    if (!annots) continue;
    for (let j = 0; j < annots.size(); j += 1) {
      if (annots.get(j) === ref) return i;
    }
  }
  return 0;
}

function tooltip(field: PDFTextField | PDFCheckBox | PDFSignature): string {
  const tu = field.acroField.dict.lookup(PDFName.of('TU'));
  if (tu instanceof PDFString) return tu.decodeText();
  return '';
}

function fieldEmpty(field: PDFTextField | PDFCheckBox | PDFSignature): boolean {
  if (field instanceof PDFCheckBox) return !field.isChecked();
  if (field instanceof PDFTextField) return !(field.getText() ?? '').trim();
  return field.acroField.dict.get(PDFName.of('V')) === undefined;
}

export async function readSignFields(bytes: Uint8Array): Promise<SignField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const found: SignField[] = [];
  for (const field of doc.getForm().getFields()) {
    if (!(field instanceof PDFTextField || field instanceof PDFCheckBox || field instanceof PDFSignature)) {
      continue;
    }
    const ft: FieldTypeName =
      field instanceof PDFSignature ? 'Sig' : field instanceof PDFCheckBox ? 'Btn' : 'Tx';
    const name = field.getName();
    const kind = classifyField(ft, `${name} ${tooltip(field)}`);
    if (!kind) continue;
    const widgets = field.acroField.getWidgets();
    widgets.forEach((widget, index) => {
      const rect = widget.getRectangle();
      const empty = fieldEmpty(field);
      const readOnly = field.isReadOnly();
      found.push({
        name: widgets.length > 1 ? `${name}#${index}` : name,
        kind,
        input: inputFor(kind),
        page: widgetPage(doc, widget),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        empty,
        readOnly,
        fillable: empty && !readOnly,
      });
    });
  }
  return found;
}

function drawStrokes(page: PDFPage, strokes: InkPoint[][], rect: PdfRect, color: InkColor): void {
  const ink = color === INK_BLUE ? rgb(0, 0.2, 0.8) : rgb(0, 0, 0);
  const thickness = Math.max(0.8, Math.min(rect.width, rect.height) * 0.035);
  for (const stroke of strokes) {
    const smooth = smoothStroke(stroke);
    for (let i = 1; i < smooth.length; i += 1) {
      const a = smooth[i - 1]!;
      const b = smooth[i]!;
      page.drawLine({
        start: { x: rect.x + a.x * rect.width, y: rect.y + a.y * rect.height },
        end: { x: rect.x + b.x * rect.width, y: rect.y + b.y * rect.height },
        thickness,
        color: ink,
      });
    }
  }
}

function drawFittedText(
  page: PDFPage,
  text: string,
  rect: PdfRect,
  font: PDFFont,
  color: InkColor,
): void {
  const value = text.trim();
  if (!value) return;
  const byHeight = rect.height * 0.62;
  const byWidth = rect.width / Math.max(1, value.length * 0.5);
  const size = Math.max(6, Math.min(22, byHeight, byWidth));
  const ink = color === INK_BLUE ? rgb(0, 0.2, 0.8) : rgb(0, 0, 0);
  page.drawText(value, {
    x: rect.x + 2,
    y: rect.y + Math.max(1, (rect.height - size) / 2),
    size,
    font,
    color: ink,
  });
}

function drawMark(page: PDFPage, mark: PageMark, body: PDFFont, script: PDFFont): void {
  if (mark.kind === 'check') {
    const { x, y, width, height } = mark.rect;
    page.drawLine({
      start: { x: x + width * 0.15, y: y + height * 0.45 },
      end: { x: x + width * 0.4, y: y + height * 0.18 },
      thickness: 1.4,
      color: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: x + width * 0.4, y: y + height * 0.18 },
      end: { x: x + width * 0.85, y: y + height * 0.82 },
      thickness: 1.4,
      color: rgb(0, 0, 0),
    });
    return;
  }
  if (mark.kind === 'cross') {
    const { x, y, width, height } = mark.rect;
    page.drawLine({
      start: { x: x + width * 0.2, y: y + height * 0.2 },
      end: { x: x + width * 0.8, y: y + height * 0.8 },
      thickness: 1.4,
      color: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: x + width * 0.8, y: y + height * 0.2 },
      end: { x: x + width * 0.2, y: y + height * 0.8 },
      thickness: 1.4,
      color: rgb(0, 0, 0),
    });
    return;
  }
  if (mark.strokes.length > 0) {
    drawStrokes(page, mark.strokes, mark.rect, mark.color);
    return;
  }
  const font = mark.kind === 'name' || mark.kind === 'signature' || mark.kind === 'initials' ? script : body;
  drawFittedText(page, mark.text, mark.rect, font, mark.color);
}

/**
 * Write the plan into a new PDF. Filled and read-only fields are not touched.
 * Existing page text stays. The buffer passed in is not modified.
 */
export async function flattenSignFill(bytes: Uint8Array, plan: SignPlan): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
  const form = doc.getForm();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const pages = doc.getPages();

  for (const mark of plan.marks) {
    const page = pages[mark.page];
    if (page) drawMark(page, mark, body, script);
  }

  const wanted = new Map(plan.fields.map((fill) => [fill.name, fill]));
  for (const field of form.getFields()) {
    const fill = wanted.get(field.getName());
    if (!fill) continue;
    if (field instanceof PDFSignature) {
      const widget = field.acroField.getWidgets()[0];
      const page = widget ? pages[widgetPage(doc, widget)] : undefined;
      if (widget && page && fill.signature) {
        const rect = widget.getRectangle();
        const box = fitInto(
          { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          fill.signature.mode === 'drawn' ? 3.2 : Math.max(1, fill.signature.text.length * 0.45),
        );
        if (fill.signature.mode === 'drawn') drawStrokes(page, fill.signature.strokes, box, fill.signature.color);
        else drawFittedText(page, fill.signature.text, box, script, fill.signature.color);
      }
      form.removeField(field);
      continue;
    }
    if (field instanceof PDFCheckBox) {
      if (fill.checked) field.check();
      continue;
    }
    if (field instanceof PDFTextField && fill.text) {
      field.setText(fill.text);
    }
  }

  form.flatten();
  return doc.save({ useObjectStreams: true });
}
