// PDF operations on bytes — pure pdf-lib, no file system, unit-tested in
// Node (tests/pdf.test.ts). src/lib/pdf.ts does the file I/O around them.
import { PDFDocument, PDFName } from 'pdf-lib';

export interface PdfInput {
  kind: 'pdf' | 'image';
  bytes: Uint8Array;
}

export interface PdfOutput {
  bytes: Uint8Array;
  pages: number;
}

const LOAD = { ignoreEncryption: true } as const;

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

/** Document-level structure that copying pages into a new file would lose. */
function hasDocumentStructure(doc: PDFDocument): boolean {
  const catalog = doc.catalog;
  return ['Outlines', 'AcroForm', 'Names', 'Dests', 'StructTreeRoot'].some(
    (key) => catalog.get(PDFName.of(key)) !== undefined,
  );
}

/**
 * "Compress": re-save with object streams. When the PDF has no
 * bookmarks, form fields or named links, its pages are also copied into a
 * fresh file so leftover unused objects (old edits) are dropped; when it
 * does, a plain re-save keeps all of that intact.
 * Embedded images are NOT re-encoded, so photo-heavy PDFs barely change.
 * Never returns a bigger file: if nothing shrinks, the original comes
 * back with `shrunk: false`.
 */
export async function compressPdfBytes(
  bytes: Uint8Array,
): Promise<PdfOutput & { shrunk: boolean }> {
  const doc = await PDFDocument.load(bytes, LOAD);
  let saved: PdfOutput;
  if (hasDocumentStructure(doc)) {
    saved = await finish(doc);
  } else {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    const title = doc.getTitle();
    if (title) out.setTitle(title);
    saved = await finish(out);
  }
  if (saved.bytes.length >= bytes.length) {
    return { bytes, pages: doc.getPageCount(), shrunk: false };
  }
  return { ...saved, shrunk: true };
}
