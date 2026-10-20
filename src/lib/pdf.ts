import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { tempFileUri } from './files';
import {
  compressPdfBytes,
  extractPdfBytes,
  mergePdfBytes,
  pageCountOf,
  shrinkPdfImages,
  type JpegReencoder,
  type PdfOutput,
} from './pdfCore';

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
