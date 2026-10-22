/**
 * Where an opened PDF goes.
 *
 * iOS has no user-selectable default PDF app. Everytool registers for
 * com.adobe.pdf at LSHandlerRank Alternate, so it shows up under Open In
 * and the share sheet. It does not replace the system's viewer.
 *
 * A PDF that arrives here opens the existing PDF tool (merge, split,
 * compress) with the file loaded. Sign & Fill stays unwired until those
 * mockups are approved.
 *
 * The native handler copies a security-scoped URL into the app sandbox
 * before this module sees it. These functions only decide the route.
 */

export const PDF_UTI = 'com.adobe.pdf';
export const PDF_HANDLER_RANK = 'Alternate' as const;
/** Existing PDF tool. Sign & Fill is a later screen. */
export const PDF_OPEN_SCREEN = 'viewer' as const;

export interface PdfDocumentRoute {
  kind: 'pdf';
  tool: 'pdf';
  screen: typeof PDF_OPEN_SCREEN;
  name: string;
}

export interface ToolLinkRoute {
  kind: 'tool';
  /** Same ref parseToolRef already accepts: "pdf", "stitch/record", "session". */
  ref: string;
}

export type IncomingRoute = PdfDocumentRoute | ToolLinkRoute | { kind: 'ignore' };

export interface ShareInboxItem {
  kind: string;
  tool: string;
  file: string;
  /** Original file name, when the share extension stored one. */
  name?: string;
}

export interface PdfShareTarget {
  tool: 'pdf';
  screen: typeof PDF_OPEN_SCREEN;
  file: string;
  name: string;
}

function parsed(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function lastSegment(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

/** A file URL whose name ends in .pdf. Deep links and web URLs are not documents. */
export function isPdfFileUrl(raw: string): boolean {
  const url = parsed(raw);
  if (!url || url.protocol !== 'file:') return false;
  return lastSegment(url).toLowerCase().endsWith('.pdf');
}

/** The name shown on the PDF tool. Falls back when the URL has no file name. */
export function pdfDisplayName(raw: string): string {
  const url = parsed(raw);
  const segment = url ? lastSegment(url) : '';
  const base = segment.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!base) return 'document.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/**
 * File name inside the sandbox copy. `unique` keeps two opens of the same
 * PDF from overwriting each other. The display name stays pdfDisplayName.
 */
export function sandboxPdfFileName(displayName: string, unique: string): string {
  const stem = (displayName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'document').slice(
    0,
    80,
  );
  const id = unique.replace(/[^A-Za-z0-9_-]/g, '') || 'open';
  return `${id}-${stem}.pdf`;
}

/**
 * `everytool://tool/<id>` and the short forms the controls already use.
 * A file URL is not a tool link.
 */
export function toolRefFromUrl(raw: string): string | null {
  const url = parsed(raw);
  if (!url || url.protocol !== 'everytool:') return null;
  const host = url.hostname;
  const path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
  if (host === 'tool') return path || null;
  if (path.startsWith('tool/')) return path.slice('tool/'.length);
  if (host === 'stitch' || path === 'stitch') return 'stitch';
  if (host === 'record' || path === 'record') return 'record';
  if (host === 'session' || path === 'session') return 'session';
  return null;
}

/**
 * A PDF file URL opens the PDF tool. An everytool:// link stays a tool
 * link — the share extension uses one of those after it has copied the
 * file into the inbox.
 */
export function routeIncomingUrl(raw: string): IncomingRoute {
  if (isPdfFileUrl(raw)) {
    return { kind: 'pdf', tool: 'pdf', screen: PDF_OPEN_SCREEN, name: pdfDisplayName(raw) };
  }
  const ref = toolRefFromUrl(raw);
  if (ref) return { kind: 'tool', ref };
  return { kind: 'ignore' };
}

/**
 * The share sheet action is named Everytool. When every attachment is a
 * PDF, that one tap opens the PDF tool. Photos and text keep their own routes.
 */
export function shareActionFor(kinds: readonly string[]): 'pdf' | null {
  if (kinds.length > 0 && kinds.every((kind) => kind === 'pdf')) return 'pdf';
  return null;
}

/**
 * A shared PDF opens the PDF tool even if the inbox row was tagged with
 * another tool. Text still wins when the share is text, matching the
 * clipboard route. The screen is the existing viewer.
 */
export function pdfTargetFromShare(items: readonly ShareInboxItem[]): PdfShareTarget | null {
  if (items.length === 0 || items.some((item) => item.kind === 'text')) return null;
  const pdf = items.find((item) => item.kind === 'pdf');
  if (!pdf) return null;
  const named = pdf.name?.trim() ?? '';
  const name = named && /\.pdf$/i.test(named) ? named.replace(/[\\/:*?"<>|]/g, '') : pdf.file;
  return { tool: 'pdf', screen: PDF_OPEN_SCREEN, file: pdf.file, name: name || pdf.file };
}
