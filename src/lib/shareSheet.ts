// What each Share button hands to the iOS share sheet. Pure: the caller
// opens UIActivityViewController (React Native Share) with the result.
// A file share is only the file URL. Adding the text as a second item
// makes iOS drop every action that can't take both, including Save Image,
// Copy, and Print.

export interface SheetItem {
  /** file:// URL of a PNG, JPEG, HEIC, GIF, or PDF. */
  url?: string;
  /** Plain text, used only when there is no file. */
  message?: string;
  /** Mail subject. Not an activity item, so it does not hide image actions. */
  subject?: string;
}

const FILE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/gif',
  'application/pdf',
  'application/vnd.everytool.etsplit+json',
]);

/** A local file URL iOS will treat as a file, not a link. */
export function fileShareUrl(uri: string): string | null {
  const trimmed = uri.trim();
  if (/^file:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `file://${trimmed}`;
  return null;
}

/**
 * Build the share-sheet payload. Image and PDF shares never include
 * `message`. `subject` is optional mail text (a QR's content, for example).
 */
export function shareItem(input: {
  uri?: string | null;
  mimeType?: string | null;
  text?: string | null;
  subject?: string | null;
}): SheetItem {
  const mime = (input.mimeType ?? '').trim().toLowerCase();
  const subject = input.subject?.replace(/\s+/g, ' ').trim();
  if (FILE_MIMES.has(mime) && input.uri) {
    const url = fileShareUrl(input.uri);
    if (!url) return {};
    return subject ? { url, subject } : { url };
  }
  const message = input.text?.trim() ?? '';
  if (!message) return {};
  return subject ? { message, subject } : { message };
}

/** Drop a data-URL prefix so the bytes written to disk are a PNG file. */
export function pngFileBase64(data: string): string {
  const trimmed = data.trim();
  const marker = 'base64,';
  const at = trimmed.indexOf(marker);
  return at >= 0 ? trimmed.slice(at + marker.length) : trimmed;
}
