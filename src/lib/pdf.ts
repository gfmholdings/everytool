import { File } from 'expo-file-system';

import { tempFileUri } from './files';
import {
  compressPdfBytes,
  extractPdfBytes,
  mergePdfBytes,
  pageCountOf,
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

/** Object-stream re-save; drops leftovers when safe; never bigger. */
export async function compressPdf(uri: string): Promise<PdfResult> {
  const out = await compressPdfBytes(await new File(uri).bytes());
  return writeResult(out, out.shrunk);
}

export async function pdfPageCount(uri: string): Promise<number> {
  return pageCountOf(await new File(uri).bytes());
}
