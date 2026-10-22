// PDF operations on bytes — pure pdf-lib, no file system, unit-tested in
// Node (tests/pdf.test.ts). src/lib/pdf.ts does the file I/O around them.
import pako from 'pako';
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFString,
  PDFTextField,
  type PDFField,
} from 'pdf-lib';

export interface PdfInput {
  kind: 'pdf' | 'image';
  bytes: Uint8Array;
}

export interface PdfOutput {
  bytes: Uint8Array;
  pages: number;
}

/** Do not rewrite Producer or ModDate. Compress keeps the Info dictionary. */
const LOAD = { ignoreEncryption: true, updateMetadata: false } as const;

/**
 * Compress never draws a page into an image and never prints the file.
 * The only pixel work is a new JPEG for an existing image XObject.
 */
export const COMPRESS_RASTERIZES_PAGES = false;

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

async function finish(doc: PDFDocument): Promise<PdfOutput> {
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount() };
}

export async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, LOAD);
  return doc.getPageCount();
}

/** Merge in list order. Images (JPEG or PNG) become one page each, sized to the image. */
export async function mergePdfBytes(inputs: PdfInput[]): Promise<PdfOutput> {
  if (inputs.length === 0) throw new Error('Add at least one file.');
  const out = await PDFDocument.create();
  for (const input of inputs) {
    if (input.kind === 'pdf') {
      const doc = await PDFDocument.load(input.bytes, LOAD);
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else {
      const image = isJpeg(input.bytes)
        ? await out.embedJpg(input.bytes)
        : isPng(input.bytes)
          ? await out.embedPng(input.bytes)
          : null;
      if (!image) throw new Error('That image isn’t a JPEG or PNG.');
      const page = out.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
  }
  return finish(out);
}

/** Keep the given 0-based pages, in the order given. Out-of-range pages are ignored. */
export async function extractPdfBytes(bytes: Uint8Array, indices: number[]): Promise<PdfOutput> {
  const doc = await PDFDocument.load(bytes, LOAD);
  const valid = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < doc.getPageCount());
  if (valid.length === 0) throw new Error('None of those pages are in this PDF.');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, valid);
  pages.forEach((p) => out.addPage(p));
  return finish(out);
}

/**
 * Re-save with object streams and drop objects nothing points at, including
 * duplicate image XObjects. The catalog, pages, text, fonts, links,
 * bookmarks, forms, annotations, and metadata stay in this document.
 * Pages are not copied into a new file. Embedded images are not re-encoded,
 * so photo-heavy PDFs barely change. Never returns a bigger file.
 */
export async function compressPdfBytes(
  bytes: Uint8Array,
): Promise<PdfOutput & { shrunk: boolean }> {
  const doc = await PDFDocument.load(bytes, LOAD);
  dedupeImageXObjects(doc);
  dropUnreferenced(doc);
  const saved = await finish(doc);
  if (saved.bytes.length >= bytes.length) {
    return { bytes, pages: doc.getPageCount(), shrunk: false };
  }
  return { ...saved, shrunk: true };
}

// ---------------------------------------------------------------------------
// Real compression: recompress the photos inside a PDF.
// ---------------------------------------------------------------------------

/** Re-encodes one JPEG (the platform does this natively). null = keep original. */
export type JpegReencoder = (
  jpeg: Uint8Array,
  width: number,
  height: number,
) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

export interface ShrinkReport extends PdfOutput {
  shrunk: boolean;
  /** JPEG photos found / actually replaced with a smaller version. */
  images: number;
  replaced: number;
}

function isDct(filter: unknown): boolean {
  const dct = PDFName.of('DCTDecode');
  if (filter === dct) return true;
  return filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === dct;
}

/**
 * Recompress every JPEG photo (DCTDecode image XObject) larger than
 * `minBytes` with `reencode` — typically: cap the long side and lower the
 * JPEG quality. A photo is only replaced when its new version is at least
 * 10% smaller. Everything else (text, vector art, fonts, forms) is left
 * byte-for-byte as it was. Never returns a bigger file.
 */
export async function shrinkPdfImages(
  bytes: Uint8Array,
  reencode: JpegReencoder,
  opts: { minBytes?: number } = {},
): Promise<ShrinkReport> {
  const doc = await PDFDocument.load(bytes, LOAD);
  const { images, replaced } = await replaceJpegXObjects(doc, reencode, {
    minBytes: opts.minBytes ?? 30_000,
    maxRatio: 0.9,
  });
  if (replaced === 0) {
    return { bytes, pages: doc.getPageCount(), shrunk: false, images, replaced: 0 };
  }
  const saved = await finish(doc);
  if (saved.bytes.length >= bytes.length) {
    return { bytes, pages: doc.getPageCount(), shrunk: false, images, replaced: 0 };
  }
  return { ...saved, shrunk: true, images, replaced };
}

export interface InPlaceImageStep {
  dpi: number;
  quality: number;
  maxLongSide: number;
}

export interface TargetCompressResult extends PdfOutput {
  shrunk: boolean;
  unmet: boolean;
  action: 'noop' | 'compress' | 'smallest';
  before: number;
  after: number;
  dpi: number | null;
  quality: number | null;
  maxLongSide: number | null;
  images: number;
  replaced: number;
  message: string;
  /** Page content was not redrawn. */
  rasterized: false;
  structure: 'kept';
  text: 'kept';
}

/**
 * Hit `maxBytes` by recompressing JPEG image XObjects in place, then
 * dropping unreferenced and duplicate objects and writing object streams.
 * Each step starts from the original bytes. The first step under the
 * target wins. If none can, the smallest of those files is returned and
 * `unmet` is set. There is no rasterize or print fallback.
 * `stripPrivacy` removes Author and Keywords only. Title and the rest stay.
 */
export async function compressPdfToTarget(
  bytes: Uint8Array,
  maxBytes: number,
  steps: readonly InPlaceImageStep[],
  reencode: (
    jpeg: Uint8Array,
    width: number,
    height: number,
    step: InPlaceImageStep,
  ) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>,
  opts: { stripPrivacy?: boolean } = {},
): Promise<TargetCompressResult> {
  const before = bytes.length;
  const limitBytes = Math.round(maxBytes);
  if (!Number.isFinite(before) || before < 1) throw new Error('This PDF is empty.');
  if (!Number.isFinite(limitBytes) || limitBytes < 1) throw new Error('Enter a target size.');
  const limit = formatByteSize(limitBytes);
  const base = {
    before,
    rasterized: false as const,
    structure: 'kept' as const,
    text: 'kept' as const,
    pages: 0,
    images: 0,
    replaced: 0,
  };
  if (before <= limitBytes) {
    const message =
      before === limitBytes
        ? `Already ${formatByteSize(before)}. Left as it is.`
        : `Already ${formatByteSize(before)}, under ${limit}. Left as it is.`;
    return {
      ...base,
      bytes,
      pages: await pageCountOf(bytes),
      action: 'noop',
      shrunk: false,
      unmet: false,
      after: before,
      dpi: null,
      quality: null,
      maxLongSide: null,
      message,
    };
  }

  const stripPrivacy = opts.stripPrivacy === true;
  const best: {
    current: { bytes: Uint8Array; pages: number; images: number; replaced: number; step: InPlaceImageStep | null } | null;
  } = { current: null };
  const consider = (
    out: { bytes: Uint8Array; pages: number; images: number; replaced: number },
    step: InPlaceImageStep | null,
  ) => {
    if (out.bytes.length >= before) return;
    if (!best.current || out.bytes.length < best.current.bytes.length) {
      best.current = { ...out, step };
    }
  };

  const plain = await recompress(bytes, null, stripPrivacy);
  consider(plain, null);
  if (plain.bytes.length <= limitBytes && plain.bytes.length < before) {
      return fitResult(base, plain, null);
  }

  for (const step of steps) {
    const out = await recompress(
      bytes,
      (jpeg, width, height) => reencode(jpeg, width, height, step),
      stripPrivacy,
    );
    consider(out, step);
    if (out.bytes.length <= limitBytes && out.bytes.length < before) {
      return fitResult(base, out, step);
    }
  }

  const afterBytes = best.current ? best.current.bytes : bytes;
  const after = afterBytes.length;
  const step = best.current?.step ?? null;
  const photos = (best.current?.replaced ?? 0) > 0;
  const message = photos
    ? `Cannot get under ${limit} without making the photos hard to read. Smallest is ${formatByteSize(after)}. The text is unchanged.`
    : `Cannot get under ${limit} without redrawing the pages. Smallest is ${formatByteSize(after)}. The text is unchanged.`;
  return {
    ...base,
    bytes: afterBytes,
    pages: best.current?.pages ?? plain.pages,
    images: best.current?.images ?? 0,
    replaced: best.current?.replaced ?? 0,
    action: 'smallest',
    shrunk: after < before,
    unmet: true,
    after,
    dpi: step?.dpi ?? null,
    quality: step?.quality ?? null,
    maxLongSide: step?.maxLongSide ?? null,
    message,
  };
}

export interface PdfStructureSnapshot {
  pageCount: number;
  pages: { width: number; height: number; rotation: number }[];
  text: string;
  outline: string[];
  fields: { name: string; value: string }[];
  signatures: string[];
  links: string[];
  annotations: string[];
  metadata: { title: string; author: string; subject: string; keywords: string; producer: string };
}

/** What compress is required to leave unchanged, apart from an optional privacy strip. */
export async function readPdfStructure(bytes: Uint8Array): Promise<PdfStructureSnapshot> {
  const doc = await PDFDocument.load(bytes, LOAD);
  const pages = doc.getPages();
  const text = pages.map((page) => pageText(page)).join('\n');
  const fields = fieldSnapshot(doc);
  return {
    pageCount: pages.length,
    pages: pages.map((page) => ({
      width: Math.round(page.getWidth()),
      height: Math.round(page.getHeight()),
      rotation: page.getRotation().angle,
    })),
    text,
    outline: outlineTitles(doc),
    fields: fields.map(({ name, value }) => ({ name, value })),
    signatures: fields.filter((field) => field.signature).map((field) => field.name),
    links: linkUris(doc),
    annotations: annotationLabels(doc),
    metadata: {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: typeof doc.getKeywords() === 'string' ? doc.getKeywords()! : '',
      producer: doc.getProducer() ?? '',
    },
  };
}

function fitResult(
  base: { before: number; rasterized: false; structure: 'kept'; text: 'kept' },
  out: { bytes: Uint8Array; pages: number; images: number; replaced: number },
  step: InPlaceImageStep | null,
): TargetCompressResult {
  return {
    ...base,
    bytes: out.bytes,
    pages: out.pages,
    images: out.images,
    replaced: out.replaced,
    action: 'compress',
    shrunk: true,
    unmet: false,
    after: out.bytes.length,
    dpi: step?.dpi ?? null,
    quality: step?.quality ?? null,
    maxLongSide: step?.maxLongSide ?? null,
    message: `${formatByteSize(base.before)} is now ${formatByteSize(out.bytes.length)}. The text is unchanged.`,
  };
}

async function recompress(
  bytes: Uint8Array,
  reencode: JpegReencoder | null,
  stripPrivacy: boolean,
): Promise<{ bytes: Uint8Array; pages: number; images: number; replaced: number }> {
  const doc = await PDFDocument.load(bytes, LOAD);
  if (stripPrivacy) stripPrivacyInfo(doc);
  const report = reencode
    ? await replaceJpegXObjects(doc, reencode, { minBytes: 1024, maxRatio: 1 })
    : { images: 0, replaced: 0 };
  dedupeImageXObjects(doc);
  dropUnreferenced(doc);
  const saved = await finish(doc);
  return { ...saved, images: report.images, replaced: report.replaced };
}

function stripPrivacyInfo(doc: PDFDocument): void {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) return;
  info.delete(PDFName.of('Author'));
  info.delete(PDFName.of('Keywords'));
}

async function replaceJpegXObjects(
  doc: PDFDocument,
  reencode: JpegReencoder,
  opts: { minBytes: number; maxRatio: number },
): Promise<{ images: number; replaced: number }> {
  const ctx = doc.context;
  let images = 0;
  let replaced = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    if (!isDct(dict.get(PDFName.of('Filter')))) continue;
    images += 1;
    if (obj.contents.length < opts.minBytes) continue;
    const w = dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
    const h = dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
    if (w <= 0 || h <= 0) continue;
    let next: Awaited<ReturnType<JpegReencoder>> = null;
    try {
      next = await reencode(obj.contents, w, h);
    } catch {
      next = null;
    }
    if (!next || next.width > w || next.height > h) continue;
    if (next.bytes.length >= obj.contents.length) continue;
    if (opts.maxRatio < 1 && next.bytes.length > obj.contents.length * opts.maxRatio) continue;
    if (next.width !== w || next.height !== h) dict.delete(PDFName.of('SMask'));
    dict.set(PDFName.of('Width'), PDFNumber.of(next.width));
    dict.set(PDFName.of('Height'), PDFNumber.of(next.height));
    dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    dict.set(PDFName.of('Length'), PDFNumber.of(next.bytes.length));
    dict.delete(PDFName.of('Decode'));
    dict.delete(PDFName.of('DecodeParms'));
    ctx.assign(ref, PDFRawStream.of(dict, next.bytes));
    replaced += 1;
  }
  return { images, replaced };
}

/** Point later copies of the same image bytes at the first copy. */
function dedupeImageXObjects(doc: PDFDocument): number {
  const ctx = doc.context;
  const groups = new Map<string, { ref: PDFRef; contents: Uint8Array }>();
  const remap = new Map<string, PDFRef>();
  const drop: PDFRef[] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const key = imageKey(obj);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ref, contents: obj.contents });
      continue;
    }
    if (!sameBytes(existing.contents, obj.contents)) continue;
    remap.set(ref.tag, existing.ref);
    drop.push(ref);
  }
  if (drop.length === 0) return 0;
  const seen = new WeakSet<object>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) rewriteRefs(obj, remap, seen);
  for (const ref of drop) ctx.delete(ref);
  return drop.length;
}

function imageKey(obj: PDFRawStream): string {
  const dict = obj.dict;
  return [
    dict.get(PDFName.of('Width'))?.toString() ?? '',
    dict.get(PDFName.of('Height'))?.toString() ?? '',
    dict.get(PDFName.of('Filter'))?.toString() ?? '',
    dict.get(PDFName.of('ColorSpace'))?.toString() ?? '',
    dict.get(PDFName.of('SMask'))?.toString() ?? '',
    String(obj.contents.length),
    fingerprint(obj.contents),
  ].join('|');
}

function fingerprint(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function rewriteRefs(obj: PDFObject, remap: Map<string, PDFRef>, seen: WeakSet<object>): void {
  if (seen.has(obj)) return;
  seen.add(obj);
  if (obj instanceof PDFRawStream || obj instanceof PDFStream) {
    rewriteRefs(obj.dict, remap, seen);
    return;
  }
  if (obj instanceof PDFDict) {
    for (const [key, value] of obj.entries()) {
      if (value instanceof PDFRef) {
        const next = remap.get(value.tag);
        if (next) obj.set(key, next);
      } else {
        rewriteRefs(value, remap, seen);
      }
    }
    return;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i += 1) {
      const value = obj.get(i);
      if (value instanceof PDFRef) {
        const next = remap.get(value.tag);
        if (next) obj.set(i, next);
      } else if (value) {
        rewriteRefs(value, remap, seen);
      }
    }
  }
}

function dropUnreferenced(doc: PDFDocument): number {
  const ctx = doc.context;
  const keep = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    if (obj instanceof PDFRef) {
      if (keep.has(obj.tag)) return;
      keep.add(obj.tag);
      visit(ctx.lookup(obj));
      return;
    }
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFRawStream || obj instanceof PDFStream) {
      visit(obj.dict);
      return;
    }
    if (obj instanceof PDFDict) {
      for (const value of obj.values()) visit(value);
      return;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) visit(obj.get(i));
    }
  };
  visit(ctx.trailerInfo.Root);
  visit(ctx.trailerInfo.Info);
  visit(ctx.trailerInfo.ID);
  visit(ctx.trailerInfo.Encrypt);
  let dropped = 0;
  for (const [ref] of [...ctx.enumerateIndirectObjects()]) {
    if (!keep.has(ref.tag)) {
      ctx.delete(ref);
      dropped += 1;
    }
  }
  return dropped;
}

function formatByteSize(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes >= mb) {
    const n = bytes / mb;
    const whole = Math.abs(n - Math.round(n)) < 0.05;
    const shown = whole || n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
    return `${shown} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fieldSnapshot(doc: PDFDocument): { name: string; value: string; signature: boolean }[] {
  if (!doc.catalog.get(PDFName.of('AcroForm'))) return [];
  return doc.getForm().getFields().map((field) => ({
    name: field.getName(),
    value: fieldValue(field),
    signature: field instanceof PDFSignature,
  }));
}

function fieldValue(field: PDFField): string {
  if (field instanceof PDFTextField) return field.getText() ?? '';
  if (field instanceof PDFCheckBox) return field.isChecked() ? 'Yes' : 'Off';
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected().join(',');
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? '';
  if (field instanceof PDFSignature) return 'signature';
  return '';
}

function outlineTitles(doc: PDFDocument): string[] {
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!root) return [];
  const titles: string[] = [];
  const seen = new Set<string>();
  const walk = (node: PDFDict | undefined): void => {
    if (!node) return;
    const ref = doc.context.getObjectRef(node);
    if (ref) {
      if (seen.has(ref.tag)) return;
      seen.add(ref.tag);
    }
    const title = textValue(node.get(PDFName.of('Title')));
    if (title) titles.push(title);
    walk(node.lookupMaybe(PDFName.of('First'), PDFDict));
    walk(node.lookupMaybe(PDFName.of('Next'), PDFDict));
  };
  walk(root.lookupMaybe(PDFName.of('First'), PDFDict));
  return titles;
}

function textValue(obj: PDFObject | undefined): string {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return '';
}

function linkUris(doc: PDFDocument): string[] {
  const links: string[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.get(PDFName.of('Subtype'));
      if (!(subtype instanceof PDFName) || subtype.asString() !== '/Link') continue;
      const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action?.get(PDFName.of('URI'));
      const text = textValue(uri);
      if (text) links.push(text);
    }
  }
  return links;
}

function annotationLabels(doc: PDFDocument): string[] {
  const labels: string[] = [];
  doc.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.get(PDFName.of('Subtype'));
      const name = subtype instanceof PDFName ? subtype.asString() : '/Annot';
      labels.push(`${index + 1}:${name}`);
    }
  });
  return labels;
}

function pageText(page: { node: { Contents(): PDFStream | PDFArray | undefined } }): string {
  return visibleText(streamSource(page.node.Contents()));
}

function streamSource(obj: PDFObject | undefined): string {
  if (!obj) return '';
  if (obj instanceof PDFArray) {
    return Array.from({ length: obj.size() }, (_, i) => streamSource(obj.lookup(i))).join('\n');
  }
  if (obj instanceof PDFRawStream) return latin1(decodedStream(obj));
  return '';
}

function decodedStream(stream: PDFRawStream): Uint8Array {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const names: string[] = [];
  if (filter instanceof PDFName) names.push(filter.asString());
  else if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i += 1) {
      const item = filter.get(i);
      if (item instanceof PDFName) names.push(item.asString());
    }
  }
  if (!names.includes('/FlateDecode')) return stream.contents;
  try {
    return pako.inflate(stream.contents);
  } catch {
    return stream.contents;
  }
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

function visibleText(src: string): string {
  const parts: string[] = [];
  const pattern = /\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g;
  for (const match of src.matchAll(pattern)) {
    if (match[0]!.startsWith('(')) {
      parts.push(
        match[0]!
          .slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\'),
      );
    } else {
      const clean = (match[1] ?? '').replace(/\s+/g, '');
      if (clean.length < 2 || clean.length % 2 !== 0) continue;
      let text = '';
      for (let i = 0; i < clean.length; i += 2) text += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16));
      parts.push(text);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
