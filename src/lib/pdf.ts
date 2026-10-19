import { File } from 'expo-file-system';
import { PDFDocument } from 'pdf-lib';

import { tempFileUri } from './files';

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
    const bytes = await new File(uri).bytes();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return { id: nextId(), name, kind, uri, pages: doc.getPageCount() };
  }
  return { id: nextId(), name, kind, uri, pages: 1 };
}

export interface PdfResult {
  uri: string;
  pages: number;
  bytes: number;
}

async function savePdf(doc: PDFDocument): Promise<PdfResult> {
  const bytes = await doc.save({ useObjectStreams: true });
  const uri = tempFileUri('pdf', 'everytool-pdf');
  new File(uri).write(bytes);
  return { uri, pages: doc.getPageCount(), bytes: bytes.length };
}

/** Merge sources in list order. Images become one full-bleed page each. */
export async function mergePdfSources(sources: PdfSource[]): Promise<PdfResult> {
  const out = await PDFDocument.create();
  for (const source of sources) {
    if (source.kind === 'pdf') {
      const bytes = await new File(source.uri).bytes();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else {
      const bytes = await new File(source.uri).bytes();
      // Images routed here are JPEG (Convert normalizes to .jpg first).
      const image = await out.embedJpg(bytes);
      const page = out.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }
  }
  return savePdf(out);
}

/** Extract the given 0-based page indices from a PDF into a new file. */
export async function extractPdfPages(
  uri: string,
  indices: number[],
): Promise<PdfResult> {
  const bytes = await new File(uri).bytes();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const valid = indices.filter((i) => i >= 0 && i < doc.getPageCount());
  const pages = await out.copyPages(doc, valid);
  pages.forEach((p) => out.addPage(p));
  return savePdf(out);
}

/**
 * Compress: re-save with object streams. Honest scope (same as the
 * mockup): this shrinks structure overhead, it does not re-encode images
 * inside the PDF.
 */
export async function compressPdf(uri: string): Promise<PdfResult> {
  const bytes = await new File(uri).bytes();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return savePdf(doc);
}

export async function pdfPageCount(uri: string): Promise<number> {
  const bytes = await new File(uri).bytes();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}
