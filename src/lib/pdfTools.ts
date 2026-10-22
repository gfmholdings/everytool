// Extra PDF operations. Pure pdf-lib and plain rules, so they run in Node.
// Nothing here is wired to a screen, and nothing talks to the network.
//
// On the phone the pixels, the camera, passwords, and OCR belong to
// PDFKit, CoreGraphics, VisionKit, Vision, and ImageIO. This module is
// the part that can be checked without a device: which pages, what size,
// where a watermark sits, and the PDF bytes for the operations pdf-lib
// can actually write.

import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from 'pdf-lib';

export const DPI_CHOICES = [72, 150, 300] as const;
export type RasterFormat = 'jpg' | 'png' | 'heic';
export type PageSizeId = 'a4' | 'letter' | 'fit';
export type PageOrientation = 'portrait' | 'landscape';
export type CompressLevel = 'low' | 'medium' | 'high';
export type ExportDestination = 'photos' | 'files' | 'share';

/** Points. A4 is 210×297 mm, Letter is 8.5×11 in. */
export const PAGE_POINTS = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

/**
 * Low changes the file the least. High aims at the smallest file.
 * The phone re-encodes JPEG photos at this quality and long side.
 */
export const COMPRESS_PRESETS: Record<CompressLevel, { quality: number; maxLongSide: number }> = {
  low: { quality: 0.72, maxLongSide: 2400 },
  medium: { quality: 0.55, maxLongSide: 1600 },
  high: { quality: 0.38, maxLongSide: 1100 },
};

const QUALITY_STEPS = [0.85, 0.72, 0.55, 0.38];
const SIDE_STEPS = [2400, 1600, 1100, 800];

/**
 * Upload limits. Resize offers these same chips once a photo is past the
 * small portal sizes (50 KB, 100 KB, 200 KB), which stay on that screen.
 * The byte values match SIZE_CHIPS in src/lib/resizePlan.ts.
 */
export const PDF_TARGET_CHIPS = [
  { id: '500kb', label: '500 KB', bytes: 500 * 1024 },
  { id: '1mb', label: '1 MB', bytes: 1024 * 1024 },
  { id: '2mb', label: '2 MB', bytes: 2 * 1024 * 1024 },
  { id: '5mb', label: '5 MB', bytes: 5 * 1024 * 1024 },
  { id: '10mb', label: '10 MB', bytes: 10 * 1024 * 1024 },
  { id: '20mb', label: '20 MB', bytes: 20 * 1024 * 1024 },
  { id: '25mb', label: '25 MB', bytes: 25 * 1024 * 1024 },
] as const;

/** Gentlest first. Quality drops before resolution, and 0.4 at 72 DPI is the last readable step. */
export const PDF_DPI_LADDER = [300, 150, 100, 72] as const;
export const PDF_QUALITY_LADDER = [0.85, 0.72, 0.55, 0.4] as const;
/** Below this, photos are treated as too far gone to offer. */
export const PDF_QUALITY_FLOOR = 0.4;

/** Long side, in pixels, of an 11-inch page at `dpi`. Images are never upscaled to reach it. */
export function pdfLongSideAtDpi(dpi: number): number {
  if (!Number.isFinite(dpi) || dpi < 36 || dpi > 600) throw new Error('Choose a DPI from 36 to 600.');
  return Math.round(11 * dpi);
}

export type ToolStatus = 'in-app' | 'partial' | 'groundwork' | 'device' | 'not-feasible';

export interface PdfHubItem {
  id: string;
  name: string;
  status: ToolStatus;
  /** Where the work actually runs. */
  engine: string;
}

/**
 * What the PDF tool can promise offline.
 * `in-app` is on the current screen. `device` is a real iOS API this
 * module does not call. `not-feasible` has no honest on-device path.
 */
export const PDF_HUB: readonly PdfHubItem[] = [
  { id: 'to-images', name: 'PDF to images', status: 'groundwork', engine: 'PDFKit + ImageIO' },
  { id: 'from-images', name: 'Images to PDF', status: 'groundwork', engine: 'pdf-lib' },
  { id: 'scan', name: 'Scan to PDF', status: 'device', engine: 'VisionKit, then Images to PDF' },
  { id: 'merge', name: 'Merge', status: 'in-app', engine: 'pdf-lib' },
  { id: 'split', name: 'Split', status: 'partial', engine: 'pdf-lib' },
  { id: 'remove', name: 'Remove pages', status: 'groundwork', engine: 'pdf-lib' },
  { id: 'reorder', name: 'Reorder', status: 'partial', engine: 'pdf-lib' },
  { id: 'rotate', name: 'Rotate', status: 'groundwork', engine: 'pdf-lib' },
  { id: 'compress', name: 'Compress', status: 'partial', engine: 'pdf-lib + ImageIO' },
  { id: 'page-numbers', name: 'Page numbers', status: 'groundwork', engine: 'pdf-lib' },
  { id: 'watermark', name: 'Watermark', status: 'groundwork', engine: 'pdf-lib' },
  { id: 'protect', name: 'Protect', status: 'device', engine: 'PDFKit' },
  { id: 'unlock', name: 'Unlock', status: 'device', engine: 'PDFKit' },
  { id: 'ocr', name: 'OCR', status: 'device', engine: 'Vision' },
  { id: 'sign', name: 'Sign & Fill', status: 'groundwork', engine: 'pdf-lib' },
  { id: 'to-text', name: 'PDF to text', status: 'groundwork', engine: 'literal strings; PDFKit on device' },
  { id: 'any-file', name: 'Any file to PDF', status: 'groundwork', engine: 'pdf-lib; WKWebView and ImageIO on device' },
  { id: 'office', name: 'Office to PDF', status: 'not-feasible', engine: 'none' },
];

export const OFFICE_TO_PDF = {
  feasible: false as const,
  reason:
    'There is no on-device Word, Excel, or PowerPoint engine. QuickLook can preview docx, xlsx, or pptx, and Pages, Numbers, and Keynote, but it does not export a PDF. WKWebView and UIPrintPageRenderer only print a web page they have already drawn, and they cannot open those files.',
};

const LOAD = { ignoreEncryption: true } as const;

export interface PdfBytes {
  bytes: Uint8Array;
  pages: number;
}

async function finish(doc: PDFDocument): Promise<PdfBytes> {
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount() };
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes.slice(), LOAD);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function exportDestinations(output: 'pdf' | 'image'): ExportDestination[] {
  if (output === 'image') return ['photos', 'files', 'share'];
  return ['files', 'share'];
}

export function rasterPixels(widthPt: number, heightPt: number, dpi: number): { width: number; height: number } {
  if (!Number.isFinite(dpi) || dpi < 36 || dpi > 600) throw new Error('Choose a DPI from 36 to 600.');
  const width = Math.max(1, Math.round((widthPt * dpi) / 72));
  const height = Math.max(1, Math.round((heightPt * dpi) / 72));
  return { width, height };
}

function fileStem(name: string): string {
  const stem = name.trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '').trim();
  return stem || 'document';
}

export interface RasterPage {
  page: number;
  width: number;
  height: number;
  filename: string;
}

/** Which pages become images, and how big each file should be. No pixels yet. */
export function rasterPlan(input: {
  baseName: string;
  pageCount: number;
  sizes: readonly { width: number; height: number }[];
  pages: readonly number[] | 'all';
  dpi: number;
  format: RasterFormat;
}): RasterPage[] {
  if (input.pageCount < 1) throw new Error('This PDF has no pages.');
  const wanted =
    input.pages === 'all'
      ? Array.from({ length: input.pageCount }, (_, i) => i + 1)
      : input.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= input.pageCount);
  const unique: number[] = [];
  for (const page of wanted) if (!unique.includes(page)) unique.push(page);
  if (unique.length === 0) throw new Error('None of those pages are in this PDF.');
  const ext = input.format === 'jpg' ? 'jpg' : input.format;
  const stem = fileStem(input.baseName);
  return unique.map((page) => {
    const size = input.sizes[page - 1] ?? input.sizes[0] ?? { width: 612, height: 792 };
    const px = rasterPixels(size.width, size.height, input.dpi);
    const index = String(page).padStart(2, '0');
    return { page, width: px.width, height: px.height, filename: `${stem}-page-${index}.${ext}` };
  });
}

export function pageFrame(
  size: PageSizeId,
  orientation: PageOrientation,
  imageWidth: number,
  imageHeight: number,
  marginPt: number,
): { width: number; height: number } {
  const margin = clamp(marginPt, 0, 144);
  if (size === 'fit') {
    return { width: imageWidth + margin * 2, height: imageHeight + margin * 2 };
  }
  const base = PAGE_POINTS[size];
  const portrait = orientation === 'portrait';
  const width = portrait ? base.width : base.height;
  const height = portrait ? base.height : base.width;
  if (margin * 2 >= width || margin * 2 >= height) throw new Error('Those margins are wider than the page.');
  return { width, height };
}

/** Contain the image inside the page, centered, with the margin left empty. */
export function fitImageRect(
  pageWidth: number,
  pageHeight: number,
  imageWidth: number,
  imageHeight: number,
  marginPt: number,
): { x: number; y: number; width: number; height: number } {
  const margin = clamp(marginPt, 0, 144);
  const boxW = pageWidth - margin * 2;
  const boxH = pageHeight - margin * 2;
  const scale = Math.min(boxW / imageWidth, boxH / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: margin + (boxW - width) / 2,
    y: margin + (boxH - height) / 2,
    width,
    height,
  };
}

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

export interface ImagePdfItem {
  bytes: Uint8Array;
}

/**
 * One PDF page per image, in the given order. JPEG and PNG only.
 * A HEIC photo is turned into a JPEG on the phone before it gets here.
 * Scan to PDF uses this after VisionKit has cropped each page.
 */
export async function imagesToPdfBytes(
  items: readonly ImagePdfItem[],
  opts: { size: PageSizeId; orientation: PageOrientation; marginPt: number },
): Promise<PdfBytes> {
  if (items.length === 0) throw new Error('Add at least one photo.');
  const doc = await PDFDocument.create();
  for (const item of items) {
    const image = isJpeg(item.bytes)
      ? await doc.embedJpg(item.bytes)
      : isPng(item.bytes)
        ? await doc.embedPng(item.bytes)
        : null;
    if (!image) throw new Error('That photo needs to be a JPEG or PNG.');
    const frame = pageFrame(opts.size, opts.orientation, image.width, image.height, opts.marginPt);
    const page = doc.addPage([frame.width, frame.height]);
    const rect = fitImageRect(frame.width, frame.height, image.width, image.height, opts.marginPt);
    page.drawImage(image, rect);
  }
  return finish(doc);
}

/** VisionKit document camera. The cropped JPEGs then go through imagesToPdfBytes. */
export const SCAN_TO_PDF = {
  engine: 'visionkit' as const,
  size: 'a4' as const,
  orientation: 'portrait' as const,
  marginPt: 0,
};

function parseRange(spec: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let p = Math.min(a, b); p <= Math.max(a, b); p += 1) pages.add(p);
    } else if (/^\d+$/.test(trimmed)) {
      pages.add(Number(trimmed));
    }
  }
  return [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
}

export type SplitRequest =
  | { kind: 'range'; spec: string }
  | { kind: 'every'; n: number }
  | { kind: 'extract'; pages: readonly number[] };

/** Groups of 0-based page indices, one group per output PDF. */
export function splitGroups(pageCount: number, request: SplitRequest): number[][] {
  if (pageCount < 1) throw new Error('This PDF has no pages.');
  if (request.kind === 'every') {
    if (!Number.isInteger(request.n) || request.n < 1) throw new Error('Split every 1 or more pages.');
    const groups: number[][] = [];
    for (let i = 0; i < pageCount; i += request.n) {
      const group: number[] = [];
      for (let j = i; j < Math.min(pageCount, i + request.n); j += 1) group.push(j);
      groups.push(group);
    }
    return groups;
  }
  if (request.kind === 'range') {
    const pages = parseRange(request.spec, pageCount).map((p) => p - 1);
    if (pages.length === 0) throw new Error('None of those pages are in this PDF.');
    return [pages];
  }
  const seen = new Set<number>();
  const pages: number[] = [];
  for (const page of request.pages) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount || seen.has(page)) continue;
    seen.add(page);
    pages.push(page - 1);
  }
  if (pages.length === 0) throw new Error('None of those pages are in this PDF.');
  return [pages];
}

export function keptPages(pageCount: number, removeOneBased: readonly number[]): number[] {
  const drop = new Set(removeOneBased.filter((p) => Number.isInteger(p)));
  const kept = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !drop.has(i + 1));
  if (kept.length === 0) throw new Error('A PDF needs at least one page.');
  return kept;
}

/** 1-based order. Every page once. */
export function reorderPages(pageCount: number, orderOneBased: readonly number[]): number[] {
  if (orderOneBased.length !== pageCount) throw new Error('List every page once.');
  const seen = new Set<number>();
  const out: number[] = [];
  for (const page of orderOneBased) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount || seen.has(page)) {
      throw new Error('List every page once.');
    }
    seen.add(page);
    out.push(page - 1);
  }
  return out;
}

async function pdfFromIndices(bytes: Uint8Array, indices: readonly number[]): Promise<PdfBytes> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, [...indices]);
  pages.forEach((page) => out.addPage(page));
  const title = src.getTitle();
  if (title) out.setTitle(title);
  return finish(out);
}

export async function splitPdfBytes(bytes: Uint8Array, request: SplitRequest): Promise<PdfBytes[]> {
  const src = await load(bytes);
  const groups = splitGroups(src.getPageCount(), request);
  const out: PdfBytes[] = [];
  for (const indices of groups) out.push(await pdfFromIndices(bytes, indices));
  return out;
}

export async function removePdfPages(bytes: Uint8Array, removeOneBased: readonly number[]): Promise<PdfBytes> {
  const src = await load(bytes);
  return pdfFromIndices(bytes, keptPages(src.getPageCount(), removeOneBased));
}

export async function reorderPdfBytes(bytes: Uint8Array, orderOneBased: readonly number[]): Promise<PdfBytes> {
  const src = await load(bytes);
  return pdfFromIndices(bytes, reorderPages(src.getPageCount(), orderOneBased));
}

export async function rotatePdfBytes(
  bytes: Uint8Array,
  turns: readonly { page: number; quarterTurns: number }[],
): Promise<PdfBytes> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  for (const turn of turns) {
    const page = pages[turn.page];
    if (!page || !Number.isInteger(turn.quarterTurns)) continue;
    const current = page.getRotation().angle;
    const next = (((current + turn.quarterTurns * 90) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }
  return finish(doc);
}

export type NumberSpot = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center';

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: { spot: NumberSpot; ofTotal: boolean },
): Promise<PdfBytes> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, index) => {
    const label = opts.ofTotal ? `${index + 1} of ${total}` : `${index + 1}`;
    const size = 11;
    const width = font.widthOfTextAtSize(label, size);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const margin = 28;
    const x =
      opts.spot === 'bottom-left'
        ? margin
        : opts.spot === 'bottom-right'
          ? pageWidth - margin - width
          : (pageWidth - width) / 2;
    const y = opts.spot === 'top-center' ? pageHeight - margin - size : margin;
    page.drawText(label, { x, y, size, font, color: rgb(0.15, 0.15, 0.16) });
  });
  return finish(doc);
}

export type WatermarkPlace = 'center' | 'diagonal';

export function watermarkOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.18;
  return clamp(value, 0, 1);
}

export async function watermarkPdfBytes(
  bytes: Uint8Array,
  opts: { text?: string; image?: Uint8Array; opacity: number; place: WatermarkPlace },
): Promise<PdfBytes> {
  const text = opts.text?.trim() ?? '';
  if (!text && !opts.image) throw new Error('Add watermark text or an image.');
  const opacity = watermarkOpacity(opts.opacity);
  if (opacity === 0) return finish(await load(bytes));
  const doc = await load(bytes);
  const font = text ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  const embedded = opts.image
    ? isJpeg(opts.image)
      ? await doc.embedJpg(opts.image)
      : isPng(opts.image)
        ? await doc.embedPng(opts.image)
        : null
    : null;
  if (opts.image && !embedded) throw new Error('That watermark needs to be a JPEG or PNG.');
  for (const page of doc.getPages()) {
    drawWatermark(page, { text, font, image: embedded, opacity, place: opts.place });
  }
  return finish(doc);
}

function drawWatermark(
  page: PDFPage,
  opts: {
    text: string;
    font: Awaited<ReturnType<PDFDocument['embedFont']>> | null;
    image: Awaited<ReturnType<PDFDocument['embedPng']>> | null;
    opacity: number;
    place: WatermarkPlace;
  },
): void {
  const { width, height } = page.getSize();
  const rotate = opts.place === 'diagonal' ? degrees(45) : degrees(0);
  if (opts.image) {
    const scale = Math.min((width * 0.55) / opts.image.width, (height * 0.28) / opts.image.height);
    const w = opts.image.width * scale;
    const h = opts.image.height * scale;
    page.drawImage(opts.image, {
      x: (width - w) / 2,
      y: (height - h) / 2,
      width: w,
      height: h,
      opacity: opts.opacity,
      rotate,
    });
  }
  if (opts.text && opts.font) {
    const size = Math.max(18, Math.min(48, width / Math.max(4, opts.text.length * 0.55)));
    const textWidth = opts.font.widthOfTextAtSize(opts.text, size);
    page.drawText(opts.text, {
      x: (width - textWidth) / 2,
      y: height / 2 - size / 2,
      size,
      font: opts.font,
      color: rgb(0.4, 0.4, 0.42),
      opacity: opts.opacity,
      rotate,
    });
  }
}

export interface CompressTarget {
  quality: number;
  maxLongSide: number;
  bytes: number;
  unmet: boolean;
}

/**
 * Pick the strongest quality that fits `maxBytes`. `measure` is the
 * on-device JPEG re-encode. When nothing fits, the smallest try is
 * returned with unmet set.
 */
export function planCompressTarget(
  maxBytes: number,
  measure: (quality: number, maxLongSide: number) => number,
): CompressTarget {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Enter a target size.');
  let best: CompressTarget | null = null;
  let smallest: CompressTarget | null = null;
  for (const maxLongSide of SIDE_STEPS) {
    for (const quality of QUALITY_STEPS) {
      const bytes = measure(quality, maxLongSide);
      const step = { quality, maxLongSide, bytes, unmet: bytes > maxBytes };
      if (!smallest || bytes < smallest.bytes) smallest = step;
      const better =
        bytes <= maxBytes &&
        (!best || quality > best.quality || (quality === best.quality && maxLongSide > best.maxLongSide));
      if (better) best = { ...step, unmet: false };
    }
  }
  if (best) return best;
  if (!smallest) throw new Error('Enter a target size.');
  return { ...smallest, unmet: true };
}

export type PdfTargetAction = 'noop' | 'compress' | 'smallest';

export interface PdfTargetStep {
  dpi: number;
  quality: number;
  maxLongSide: number;
}

export interface PdfTargetPlan {
  action: PdfTargetAction;
  dpi: number | null;
  quality: number | null;
  maxLongSide: number | null;
  before: number;
  after: number;
  saved: number;
  unmet: boolean;
  message: string;
  /** Embedded photos change. Text, fonts, and vector drawing do not. */
  text: 'kept';
}

/** Steps the phone tries, in order, until the file is under the chip. */
export function pdfTargetSteps(): PdfTargetStep[] {
  const steps: PdfTargetStep[] = [];
  for (const dpi of PDF_DPI_LADDER) {
    for (const quality of PDF_QUALITY_LADDER) {
      steps.push({ dpi, quality, maxLongSide: pdfLongSideAtDpi(dpi) });
    }
  }
  return steps;
}

export function parsePdfTarget(amount: string, unit: 'KB' | 'MB'): number | null {
  const n = Number(amount.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const bytes = unit === 'MB' ? n * 1024 * 1024 : n * 1024;
  if (bytes > 200 * 1024 * 1024) return null;
  return Math.round(bytes);
}

function formatBytes(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes >= mb) {
    const n = bytes / mb;
    const whole = Math.abs(n - Math.round(n)) < 0.05;
    const shown = whole || n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
    return `${shown} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Lower JPEG quality, then DPI 300 → 150 → 100 → 72, until `measure`
 * reports a file under `maxBytes`. `measure` is the on-device re-encode
 * of embedded photos only. Text is never part of the attempt.
 * A file already at or under the chip is returned unchanged.
 * When the floor is still over the chip, the smallest try is offered.
 */
export function planPdfTarget(input: {
  beforeBytes: number;
  maxBytes: number;
  measure: (step: PdfTargetStep) => number;
}): PdfTargetPlan {
  const before = Math.round(input.beforeBytes);
  const maxBytes = Math.round(input.maxBytes);
  if (!Number.isFinite(before) || before < 1) throw new Error('This PDF is empty.');
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Enter a target size.');
  const limit = formatBytes(maxBytes);
  if (before <= maxBytes) {
    const message =
      before === maxBytes
        ? `Already ${formatBytes(before)}. Left as it is.`
        : `Already ${formatBytes(before)}, under ${limit}. Left as it is.`;
    return {
      action: 'noop',
      dpi: null,
      quality: null,
      maxLongSide: null,
      before,
      after: before,
      saved: 0,
      unmet: false,
      message,
      text: 'kept',
    };
  }
  let chosen: PdfTargetPlan | null = null;
  let smallest: { step: PdfTargetStep; bytes: number } | null = null;
  for (const step of pdfTargetSteps()) {
    const raw = input.measure(step);
    const bytes = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : before;
    if (bytes < before && (!smallest || bytes < smallest.bytes)) smallest = { step, bytes };
    if (bytes <= maxBytes && bytes < before) {
      chosen = {
        action: 'compress',
        dpi: step.dpi,
        quality: step.quality,
        maxLongSide: step.maxLongSide,
        before,
        after: bytes,
        saved: before - bytes,
        unmet: false,
        message: `${formatBytes(before)} is now ${formatBytes(bytes)}. The text is unchanged.`,
        text: 'kept',
      };
      break;
    }
  }
  if (chosen) return chosen;
  const after = smallest ? smallest.bytes : before;
  const step = smallest?.step ?? null;
  return {
    action: 'smallest',
    dpi: step?.dpi ?? null,
    quality: step?.quality ?? null,
    maxLongSide: step?.maxLongSide ?? null,
    before,
    after,
    saved: Math.max(0, before - after),
    unmet: true,
    message: `Cannot get under ${limit} without making the photos hard to read. Smallest is ${formatBytes(after)}. The text is unchanged.`,
    text: 'kept',
  };
}

export function sizeChange(before: number, after: number): { before: number; after: number; saved: number; shrunk: boolean } {
  const saved = Math.max(0, before - after);
  return { before, after, saved, shrunk: after < before };
}

/** PDFKit writes the real password on the phone. pdf-lib cannot encrypt a file. */
export const PROTECT_ENGINE = 'pdfkit' as const;

export function protectRequest(password: string): { engine: typeof PROTECT_ENGINE; userPassword: string } {
  const userPassword = password;
  if (userPassword.trim().length === 0) throw new Error('Enter a password.');
  if (userPassword.length > 128) throw new Error('Use 128 characters or fewer.');
  return { engine: PROTECT_ENGINE, userPassword };
}

export function unlockRequest(password: string): { engine: typeof PROTECT_ENGINE; password: string } {
  if (password.length === 0) throw new Error('Enter the password.');
  if (password.length > 128) throw new Error('Use 128 characters or fewer.');
  return { engine: PROTECT_ENGINE, password };
}

export async function pdfIsEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes);
    return doc.isEncrypted;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encrypt/i.test(message)) return true;
    throw error;
  }
}

/** Vision recognizes each page on the phone. This only joins what it returned. */
export function ocrPlainText(pages: readonly { text: string }[]): string {
  return pages
    .map((page) => page.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n');
}

export function plainTextToRtf(text: string): string {
  const body = text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\par\n');
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 ${body}}`;
}

/** A text PDF of the recognized words. The scan image, when present, is the page behind them. */
export async function searchablePdfFromOcr(
  pages: readonly { text: string; jpeg?: Uint8Array }[],
): Promise<PdfBytes> {
  if (pages.length === 0) throw new Error('Nothing was recognized.');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of pages) {
    const text = page.text.trim();
    if (page.jpeg && isJpeg(page.jpeg)) {
      const image = await doc.embedJpg(page.jpeg);
      const pdfPage = doc.addPage([image.width, image.height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      if (text) {
        pdfPage.drawText(text, {
          x: 12,
          y: 12,
          size: 8,
          font,
          color: rgb(0, 0, 0),
          opacity: 0.01,
          maxWidth: Math.max(20, image.width - 24),
        });
      }
    } else {
      const pdfPage = doc.addPage([612, 792]);
      if (text) {
        pdfPage.drawText(text, { x: 48, y: 740, size: 12, font, maxWidth: 516, lineHeight: 16 });
      }
    }
  }
  return finish(doc);
}

/**
 * Pull literal PDF strings such as `(Hello) Tj`.
 * Embedded fonts usually store words as character codes, which PDFKit
 * reads on the phone. This is the offline pass for streams that still
 * contain plain literals.
 */
export function literalsFromContent(src: string): string {
  const parts: string[] = [];
  const pattern = /\((?:\\.|[^\\)])*\)/g;
  for (const match of src.matchAll(pattern)) {
    const raw = match[0]!.slice(1, -1);
    const text = raw
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (text.trim()) parts.push(text);
  }
  return parts.join(' ');
}

export function extractLiteralText(streams: readonly string[]): string {
  return streams.map(literalsFromContent).filter((text) => text.length > 0).join('\n');
}
