import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { PDFDocument } from 'pdf-lib';

import { convertFilesToPdf, describeFile, type ConvertFile } from './pdfConvert';
import { tempFileUri } from './files';
import {
  compressPdfBytes,
  compressPdfToTarget,
  extractPdfBytes,
  mergePdfBytes,
  pageCountOf,
  shrinkPdfImages,
  type InPlaceImageStep,
  type JpegReencoder,
  type PdfOutput,
} from './pdfCore';
import {
  flattenSignFill,
  planSignFill,
  readSignFields,
  type FieldFill,
  type PageMark,
} from './pdfSign';
import {
  addPageNumbers,
  imagesToPdfBytes,
  pdfTargetSteps,
  rotatePdfBytes,
  SCAN_TO_PDF,
  watermarkPdfBytes,
  type NumberSpot,
  type WatermarkPlace,
} from './pdfTools';

// File I/O around the pure, unit-tested PDF operations in pdfCore.ts.

export interface PdfSource {
  id: string;
  name: string;
  kind: 'pdf' | 'image';
  uri: string;
  pages: number;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `pdf-${Date.now().toString(36)}-${seq}`;
}

export async function pdfSourceFromUri(
  uri: string,
  name: string,
  kind: 'pdf' | 'image',
): Promise<PdfSource> {
  if (kind === 'pdf') {
    const pages = await pageCountOf(await new File(uri).bytes());
    return { id: nextId(), name, kind, uri, pages };
  }
  return { id: nextId(), name, kind, uri, pages: 1 };
}

export interface PdfResult {
  uri: string;
  pages: number;
  bytes: number;
  /** Compress only: false when the file couldn't be made smaller. */
  shrunk?: boolean;
  /** Compress with photos: how many photos inside were made smaller. */
  photosShrunk?: number;
}

function writeResult(out: PdfOutput, shrunk?: boolean): PdfResult {
  const uri = tempFileUri('pdf', 'everytool-pdf');
  new File(uri).write(out.bytes);
  return { uri, pages: out.pages, bytes: out.bytes.length, shrunk };
}

/** VisionKit pages, already cropped, one PDF page each. Letterbox-free A4. */
export async function scannedPagesToPdf(uris: string[]): Promise<PdfResult> {
  if (uris.length === 0) throw new Error('Scan at least one page.');
  const items = [];
  for (const uri of uris) items.push({ bytes: await new File(uri).bytes() });
  const out = await imagesToPdfBytes(items, {
    size: SCAN_TO_PDF.size,
    orientation: SCAN_TO_PDF.orientation,
    marginPt: SCAN_TO_PDF.marginPt,
  });
  return writeResult(out);
}

/** Merge sources in list order. Images (JPEG/PNG) become one page each. */
export async function mergePdfSources(sources: PdfSource[]): Promise<PdfResult> {
  const inputs = [];
  for (const s of sources) inputs.push({ kind: s.kind, bytes: await new File(s.uri).bytes() });
  return writeResult(await mergePdfBytes(inputs));
}

/** Extract the given 0-based page indices from a PDF into a new file. */
export async function extractPdfPages(uri: string, indices: number[]): Promise<PdfResult> {
  return writeResult(await extractPdfBytes(await new File(uri).bytes(), indices));
}

/** The platform re-encodes each photo: long side ≤ 1600 px, JPEG 60%. */
const nativeReencoder: JpegReencoder = async (jpeg, width, height) => {
  const tmp = tempFileUri('jpg', 'pdf-photo');
  new File(tmp).write(jpeg);
  try {
    const long = Math.max(width, height);
    const actions =
      long > 1600 ? [{ resize: width >= height ? { width: 1600 } : { height: 1600 } }] : [];
    const out = await manipulateAsync(tmp, actions, { format: SaveFormat.JPEG, compress: 0.6 });
    const bytes = await new File(out.uri).bytes();
    return { bytes, width: out.width, height: out.height };
  } finally {
    try {
      new File(tmp).delete();
    } catch {
      // cache cleanup is best effort
    }
  }
};

/**
 * Compress: optionally recompress the photos inside (real shrinking for
 * scanned / photo PDFs), then re-save the structure. Never bigger.
 */
export async function compressPdf(
  uri: string,
  opts: { photos?: boolean } = {},
): Promise<PdfResult> {
  let bytes: Uint8Array = await new File(uri).bytes();
  const original = bytes.length;
  let photosShrunk = 0;
  if (opts.photos) {
    const r = await shrinkPdfImages(bytes, nativeReencoder);
    if (r.shrunk) {
      bytes = r.bytes;
      photosShrunk = r.replaced;
    }
  }
  const out = await compressPdfBytes(bytes);
  const result = writeResult(out, out.bytes.length < original);
  return { ...result, photosShrunk };
}

export async function pdfPageCount(uri: string): Promise<number> {
  return pageCountOf(await new File(uri).bytes());
}

/** Page size in PDF points, for placing a signature on a page with no form. */
export async function pdfPageSize(
  uri: string,
  page: number,
): Promise<{ width: number; height: number }> {
  const doc = await PDFDocument.load(await new File(uri).bytes(), { ignoreEncryption: true });
  const box = doc.getPage(page).getSize();
  return { width: box.width, height: box.height };
}

export async function loadSignFields(uri: string) {
  return readSignFields(await new File(uri).bytes());
}

/** Flatten typed signatures, checkbox fills, and free marks onto a new PDF. */
export async function writeSignFill(
  uri: string,
  name: string,
  fills: readonly FieldFill[],
  marks: readonly PageMark[],
): Promise<PdfResult> {
  const bytes = await new File(uri).bytes();
  const fields = await readSignFields(bytes);
  const plan = planSignFill(fields, fills, marks, name);
  if (plan.fields.length === 0 && plan.marks.length === 0) {
    throw new Error('Add a signature or fill a field first.');
  }
  const signed = await flattenSignFill(bytes, plan);
  return writeResult({ bytes: signed, pages: await pageCountOf(signed) });
}

/**
 * Keep `orderOneBased` (original page numbers, new order) and rotate those
 * pages. `turns` uses indexes in the new file.
 */
export async function applyPageLayout(
  uri: string,
  orderOneBased: readonly number[],
  turns: readonly { page: number; quarterTurns: number }[],
): Promise<PdfResult> {
  if (orderOneBased.length === 0) throw new Error('A PDF needs at least one page.');
  const extracted = await extractPdfPages(
    uri,
    orderOneBased.map((n) => n - 1),
  );
  const active = turns.filter((turn) => turn.quarterTurns % 4 !== 0);
  if (active.length === 0) return extracted;
  const rotated = await rotatePdfBytes(await new File(extracted.uri).bytes(), active);
  return writeResult(rotated);
}

export async function numberPdfPages(
  uri: string,
  spot: NumberSpot,
  ofTotal: boolean,
): Promise<PdfResult> {
  const out = await addPageNumbers(await new File(uri).bytes(), { spot, ofTotal });
  return writeResult(out);
}

export async function stampPdfWatermark(
  uri: string,
  text: string,
  place: WatermarkPlace,
): Promise<PdfResult> {
  const out = await watermarkPdfBytes(await new File(uri).bytes(), {
    text,
    opacity: 0.18,
    place,
  });
  return writeResult(out);
}

const targetReencoder = async (
  jpeg: Uint8Array,
  width: number,
  height: number,
  step: InPlaceImageStep,
) => {
  const tmp = tempFileUri('jpg', 'pdf-target');
  new File(tmp).write(jpeg);
  try {
    const long = Math.max(width, height);
    const cap = Math.max(1, Math.round(step.maxLongSide));
    const actions =
      long > cap ? [{ resize: width >= height ? { width: cap } : { height: cap } }] : [];
    const out = await manipulateAsync(tmp, actions, {
      format: SaveFormat.JPEG,
      compress: step.quality,
    });
    const bytes = await new File(out.uri).bytes();
    return { bytes, width: out.width, height: out.height };
  } finally {
    try {
      new File(tmp).delete();
    } catch {
      // cache cleanup is best effort
    }
  }
};

/**
 * Shrink a PDF toward `maxBytes` by recompressing JPEG images in place.
 * Text, fonts, and form fields stay. There is no page-raster fallback.
 */
export async function compressPdfToSize(
  uri: string,
  maxBytes: number,
): Promise<PdfResult & { message: string; unmet: boolean }> {
  const original = await new File(uri).bytes();
  const out = await compressPdfToTarget(original, maxBytes, pdfTargetSteps(), targetReencoder);
  const result = writeResult({ bytes: out.bytes, pages: out.pages }, out.shrunk);
  return { ...result, message: out.message, unmet: out.unmet, photosShrunk: out.replaced };
}

export interface ConvertedFileNote {
  name: string;
  included: boolean;
  note: string;
}

/**
 * Turn files this phone can read into one PDF. Office files, web pages,
 * and images that need ImageIO are listed and left out of the bytes.
 */
export async function filesToPdf(
  files: readonly { name: string; uri: string }[],
): Promise<{ result: PdfResult | null; notes: ConvertedFileNote[] }> {
  const payload: ConvertFile[] = [];
  for (const file of files) {
    const plan = describeFile(file.name);
    const item: ConvertFile = { name: file.name };
    if (plan.formatId === 'pdf' || plan.formatId === 'jpeg' || plan.formatId === 'png' || plan.deviceRender === 'imageio') {
      const bytes = await new File(file.uri).bytes();
      if (plan.formatId === 'pdf') item.pdf = bytes;
      else item.image = bytes;
    } else if (plan.reliability !== 'not-reliable') {
      item.text = await new File(file.uri).text();
    }
    payload.push(item);
  }
  const converted = await convertFilesToPdf(payload);
  const notes = converted.items.map((item) => ({
    name: item.name,
    included: item.included,
    note: item.note,
  }));
  if (!converted.pdf) return { result: null, notes };
  return {
    result: writeResult({ bytes: converted.pdf.bytes, pages: converted.pdf.pages }),
    notes,
  };
}
