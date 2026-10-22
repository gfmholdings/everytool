// Any file → one PDF. Pure pdf-lib and plain rules, so they run in Node.
// Nothing here is wired to the PDF screen, and nothing talks to the network.
//
// JPEG, PNG, plain text, Markdown, CSV, and the words of an RTF file are
// written here. HEIC and the other image formats are decoded by ImageIO
// on the phone, then placed the same way. HTML and a saved web archive
// are printed by WKWebView. A Safari link has to load, so it is not
// offline. Word, Excel, PowerPoint, Pages, Numbers, and Keynote are not
// converted: Quick Look can preview them and does not export a PDF.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type ConvertReliability = 'reliable' | 'offline-limited' | 'online' | 'not-reliable';

export type DeviceRender = 'none' | 'imageio' | 'wkwebview' | 'nsattributed';

export interface ConvertFormat {
  id: string;
  label: string;
  extensions: readonly string[];
  utis: readonly string[];
  reliability: ConvertReliability;
  engine: string;
  /** What the phone does, in one or two sentences. */
  note: string;
}

const OFFICE_NOTE =
  'Quick Look can preview this file. It has no call that writes a multi-page PDF. WKWebView and UIPrintPageRenderer only print a web page they have already drawn, and they cannot open this file.';

/**
 * Formats the share sheet and the in-app picker can hand over.
 * `reliable` is converted in this module, or by ImageIO into bytes this
 * module already knows how to place. `offline-limited` is a real on-device
 * render that drops anything stored on the network. `online` has to fetch.
 * `not-reliable` is refused.
 */
export const CONVERT_FORMATS: readonly ConvertFormat[] = [
  {
    id: 'jpeg',
    label: 'JPEG',
    extensions: ['jpg', 'jpeg'],
    utis: ['public.jpeg'],
    reliability: 'reliable',
    engine: 'pdf-lib',
    note: 'The photo is placed on a page on this phone.',
  },
  {
    id: 'png',
    label: 'PNG',
    extensions: ['png'],
    utis: ['public.png'],
    reliability: 'reliable',
    engine: 'pdf-lib',
    note: 'The image is placed on a page on this phone.',
  },
  {
    id: 'heic',
    label: 'HEIC',
    extensions: ['heic', 'heif'],
    utis: ['public.heic', 'public.heif'],
    reliability: 'reliable',
    engine: 'ImageIO',
    note: 'ImageIO reads the photo on this phone and the page is built from that JPEG.',
  },
  {
    id: 'gif',
    label: 'GIF',
    extensions: ['gif'],
    utis: ['public.gif'],
    reliability: 'reliable',
    engine: 'ImageIO',
    note: 'ImageIO reads the first frame on this phone and that frame becomes the page.',
  },
  {
    id: 'tiff',
    label: 'TIFF',
    extensions: ['tif', 'tiff'],
    utis: ['public.tiff'],
    reliability: 'reliable',
    engine: 'ImageIO',
    note: 'ImageIO reads the image on this phone and the page is built from that JPEG.',
  },
  {
    id: 'bmp',
    label: 'BMP',
    extensions: ['bmp'],
    utis: ['com.microsoft.bmp'],
    reliability: 'reliable',
    engine: 'ImageIO',
    note: 'ImageIO reads the image on this phone and the page is built from that JPEG.',
  },
  {
    id: 'webp',
    label: 'WebP',
    extensions: ['webp'],
    utis: ['org.webmproject.webp'],
    reliability: 'reliable',
    engine: 'ImageIO',
    note: 'ImageIO reads the image on this phone and the page is built from that JPEG.',
  },
  {
    id: 'text',
    label: 'Plain text',
    extensions: ['txt', 'text'],
    utis: ['public.plain-text', 'public.utf8-plain-text'],
    reliability: 'reliable',
    engine: 'pdf-lib',
    note: 'The words are laid out on letter pages on this phone.',
  },
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['md', 'markdown'],
    utis: ['net.daringfireball.markdown'],
    reliability: 'reliable',
    engine: 'pdf-lib',
    note: 'Headings, lists, and paragraphs are laid out on this phone. A picture in the Markdown is named, not fetched.',
  },
  {
    id: 'rtf',
    label: 'RTF',
    extensions: ['rtf', 'rtfd'],
    utis: ['public.rtf', 'public.rtfd'],
    reliability: 'reliable',
    engine: 'pdf-lib + NSAttributedString',
    note: 'The words are kept here. On the phone, NSAttributedString also keeps the fonts, colors, and sizes.',
  },
  {
    id: 'csv',
    label: 'CSV',
    extensions: ['csv'],
    utis: ['public.comma-separated-values-text'],
    reliability: 'reliable',
    engine: 'pdf-lib',
    note: 'The rows are drawn as a table on this phone.',
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['html', 'htm'],
    utis: ['public.html'],
    reliability: 'offline-limited',
    engine: 'WKWebView',
    note: 'WKWebView loads the file and createPDF prints it. UIPrintPageRenderer is the fallback. A picture or style sheet on the network is left out when the phone is offline.',
  },
  {
    id: 'webarchive',
    label: 'Web archive',
    extensions: ['webarchive'],
    utis: ['com.apple.webarchive'],
    reliability: 'offline-limited',
    engine: 'WKWebView',
    note: 'WKWebView loads the saved archive and createPDF prints it. Archives that WebKit cannot read are not converted.',
  },
  {
    id: 'weblink',
    label: 'Web page',
    extensions: ['weblink', 'url'],
    utis: ['public.url'],
    reliability: 'online',
    engine: 'WKWebView',
    note: 'Safari shares the address. WKWebView loads that address and createPDF prints the page. The load uses the network.',
  },
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['pdf'],
    utis: ['com.adobe.pdf'],
    reliability: 'reliable',
    engine: 'pdf-lib',
    note: 'The pages are copied into the combined PDF.',
  },
  {
    id: 'docx',
    label: 'Word',
    extensions: ['docx'],
    utis: ['org.openxmlformats.wordprocessingml.document'],
    reliability: 'not-reliable',
    engine: 'none',
    note: OFFICE_NOTE,
  },
  {
    id: 'xlsx',
    label: 'Excel',
    extensions: ['xlsx'],
    utis: ['org.openxmlformats.spreadsheetml.sheet'],
    reliability: 'not-reliable',
    engine: 'none',
    note: OFFICE_NOTE,
  },
  {
    id: 'pptx',
    label: 'PowerPoint',
    extensions: ['pptx'],
    utis: ['org.openxmlformats.presentationml.presentation'],
    reliability: 'not-reliable',
    engine: 'none',
    note: OFFICE_NOTE,
  },
  {
    id: 'pages',
    label: 'Pages',
    extensions: ['pages'],
    utis: ['com.apple.iwork.pages.sffpages', 'com.apple.iwork.pages.pages', 'com.apple.iwork.pages'],
    reliability: 'not-reliable',
    engine: 'none',
    note: OFFICE_NOTE,
  },
  {
    id: 'numbers',
    label: 'Numbers',
    extensions: ['numbers'],
    utis: ['com.apple.iwork.numbers.sffnumbers', 'com.apple.iwork.numbers.numbers', 'com.apple.iwork.numbers'],
    reliability: 'not-reliable',
    engine: 'none',
    note: OFFICE_NOTE,
  },
  {
    id: 'keynote',
    label: 'Keynote',
    extensions: ['key'],
    utis: ['com.apple.iwork.keynote.sffkey', 'com.apple.iwork.keynote.key', 'com.apple.iwork.keynote'],
    reliability: 'not-reliable',
    engine: 'none',
    note: OFFICE_NOTE,
  },
];

/** Shown in the share sheet when every file is one Quick Look cannot export. */
export const OFFICE_SHARE_NOTE =
  'Word, Excel, PowerPoint, Pages, Numbers, and Keynote cannot be turned into a PDF on this phone. Quick Look can preview them. It does not export a PDF.';

/** Share-sheet route id. The app opens the PDF tool; the screen is unchanged. */
export const CONVERT_ROUTE = 'pdf-convert';
export const CONVERT_ROUTE_LABEL = 'Convert to PDF';

/** Where a finished PDF can go. Photos is for images. */
export const CONVERT_EXPORTS = ['files', 'share'] as const;

/** Letter. Text, tables, and pictures share one page size so a batch is one document. */
export const CONVERT_PAGE = { width: 612, height: 792 } as const;

const MARGIN = 48;
const MAX_PAGES = 400;

const OFFICE_EXTENSIONS = new Set(
  CONVERT_FORMATS.filter((format) => format.reliability === 'not-reliable').flatMap((format) => format.extensions),
);

export function extensionOf(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function formatForName(name: string): ConvertFormat | null {
  const ext = extensionOf(name);
  if (!ext) return null;
  return CONVERT_FORMATS.find((format) => format.extensions.includes(ext)) ?? null;
}

export function formatsByReliability(): { reliability: ConvertReliability; labels: string[] }[] {
  const order: ConvertReliability[] = ['reliable', 'offline-limited', 'online', 'not-reliable'];
  return order.map((reliability) => ({
    reliability,
    labels: CONVERT_FORMATS.filter((format) => format.reliability === reliability).map((format) => format.label),
  }));
}

/** UTIs added so the share sheet offers Everytool for these files, not only photos and PDF. */
export function convertActivationUtis(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const format of CONVERT_FORMATS) {
    for (const uti of format.utis) {
      if (seen.has(uti)) continue;
      seen.add(uti);
      out.push(uti);
    }
  }
  return out;
}

/** The sentence the share sheet shows when nothing in the batch can become a PDF. */
export function officeShareNote(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const exts = names.map(extensionOf);
  if (exts.every((ext) => OFFICE_EXTENSIONS.has(ext))) return OFFICE_SHARE_NOTE;
  return null;
}

export interface ShareRouteItem {
  kind: string;
  name?: string;
}

export interface ShareRoute {
  tool: string;
  label: string;
}

/**
 * Buttons on the share sheet. PDF-only stays the existing one-tap PDF tool.
 * Photos and text keep their buttons. Convert to PDF is added for anything
 * this module can try. An all-Office batch gets the note instead of a button.
 */
export function shareRoutesFor(items: readonly ShareRouteItem[]): ShareRoute[] {
  if (items.length === 0) return [];
  const kinds = items.map((item) => item.kind);
  if (kinds.every((kind) => kind === 'pdf')) return [{ tool: 'pdf', label: 'PDF tools' }];
  const routes: ShareRoute[] = [];
  if (kinds.includes('text')) routes.push({ tool: 'clipboard', label: 'Save to clipboard' });
  const imagesOnly = kinds.every((kind) => kind === 'image');
  if (imagesOnly && items.length > 1) {
    routes.push({ tool: 'stitch', label: 'Stitch together' }, { tool: 'convert', label: 'Convert first photo' });
  } else if (imagesOnly) {
    routes.push(
      { tool: 'convert', label: 'Convert' },
      { tool: 'resize', label: 'Resize' },
      { tool: 'qr', label: 'Scan QR code' },
      { tool: 'stitch', label: 'Stitch' },
    );
  } else if (kinds.includes('pdf')) {
    routes.push({ tool: 'pdf', label: 'PDF tools' });
  }
  if (!officeShareNote(items.map((item) => item.name ?? ''))) {
    routes.push({ tool: CONVERT_ROUTE, label: CONVERT_ROUTE_LABEL });
  }
  return routes;
}

/** http(s) and protocol-relative URLs in HTML. Relative files are not remote. */
export function htmlRemoteUrls(html: string): string[] {
  const found: string[] = [];
  const attr = /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const css = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\)/gi;
  const imp = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
  for (const pattern of [attr, css, imp]) {
    for (const match of html.matchAll(pattern)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (/^(https?:)?\/\//i.test(value)) found.push(value);
    }
  }
  return [...new Set(found)];
}

export function webPagePlan(url: string): { offline: boolean; engine: 'wkwebview'; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { offline: false, engine: 'wkwebview', reason: 'That is not a web address.' };
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return {
      offline: false,
      engine: 'wkwebview',
      reason:
        'Safari hands over the address. WKWebView loads it and createPDF prints it. That load uses the network, so this is not an offline conversion.',
    };
  }
  if (parsed.protocol === 'file:') {
    return {
      offline: true,
      engine: 'wkwebview',
      reason: 'This file is on the phone. WKWebView createPDF can print it without the network.',
    };
  }
  return {
    offline: false,
    engine: 'wkwebview',
    reason: 'WKWebView can print a page it has loaded. This address is not a local file.',
  };
}

function urlFromText(text: string): string {
  const shortcut = text.match(/^\s*URL=(.+)$/im);
  if (shortcut?.[1]) return shortcut[1].trim();
  return text.trim();
}

export interface FilePlan {
  formatId: string;
  label: string;
  reliability: ConvertReliability;
  engine: string;
  note: string;
  deviceRender: DeviceRender;
}

/** What would happen to one file, before any PDF bytes are written. */
export function describeFile(name: string, text?: string): FilePlan {
  const format = formatForName(name);
  if (!format) {
    return {
      formatId: 'unknown',
      label: 'Unknown',
      reliability: 'not-reliable',
      engine: 'none',
      note: 'This file is not one Everytool can turn into a PDF on this phone.',
      deviceRender: 'none',
    };
  }
  if (format.id === 'html') {
    const remote = htmlRemoteUrls(text ?? '');
    if (remote.length > 0) {
      return {
        formatId: format.id,
        label: format.label,
        reliability: 'online',
        engine: format.engine,
        note: 'This page loads pieces from the network. Offline, those pieces are missing. WKWebView createPDF prints whatever did load.',
        deviceRender: 'wkwebview',
      };
    }
    return { ...planFromFormat(format), deviceRender: 'wkwebview' };
  }
  if (format.id === 'webarchive') return { ...planFromFormat(format), deviceRender: 'wkwebview' };
  if (format.id === 'weblink') {
    const plan = webPagePlan(urlFromText(text ?? ''));
    return {
      formatId: format.id,
      label: format.label,
      reliability: plan.offline ? 'offline-limited' : 'online',
      engine: format.engine,
      note: plan.reason,
      deviceRender: 'wkwebview',
    };
  }
  if (format.engine === 'ImageIO') return { ...planFromFormat(format), deviceRender: 'imageio' };
  if (format.id === 'rtf') return { ...planFromFormat(format), deviceRender: 'nsattributed' };
  return { ...planFromFormat(format), deviceRender: 'none' };
}

function planFromFormat(format: ConvertFormat): Omit<FilePlan, 'deviceRender'> {
  return {
    formatId: format.id,
    label: format.label,
    reliability: format.reliability,
    engine: format.engine,
    note: format.note,
  };
}

export function rtfToPlain(rtf: string): string {
  const src = rtf.replace(/^\uFEFF/, '');
  if (!/^\s*\{\\rtf/i.test(src)) return src.trim();
  const skipDestinations = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'pict',
    'object',
    'datastore',
    'themedata',
    'listtable',
    'listoverridetable',
    'rsidtbl',
    'header',
    'footer',
    'headerl',
    'headerr',
    'footerl',
    'footerr',
    'footnote',
  ]);
  let out = '';
  let i = 0;
  const groupSkip: boolean[] = [];
  let skipping = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '{') {
      groupSkip.push(skipping);
      const rest = src.slice(i + 1, i + 48);
      const dest = /^\\(\*\\)?([A-Za-z]+)/.exec(rest);
      const word = dest?.[2] ?? '';
      if (dest && (dest[1] || skipDestinations.has(word))) skipping = true;
      i += 1;
      continue;
    }
    if (c === '}') {
      skipping = groupSkip.pop() ?? false;
      i += 1;
      continue;
    }
    if (c === '\\') {
      const next = src[i + 1] ?? '';
      if (next === '\\' || next === '{' || next === '}') {
        if (!skipping) out += next;
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (!skipping && /^[0-9a-fA-F]{2}$/.test(hex)) out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      if (next === 'u' && /[-0-9]/.test(src[i + 2] ?? '')) {
        let j = i + 2;
        let num = '';
        if (src[j] === '-') {
          num = '-';
          j += 1;
        }
        while (j < src.length && /[0-9]/.test(src[j]!)) {
          num += src[j];
          j += 1;
        }
        const code = Number(num);
        if (!skipping && Number.isFinite(code)) {
          out += String.fromCharCode(code < 0 ? code + 65536 : code);
        }
        if (src[j] === ' ') j += 1;
        else if (src[j] === '\\' && src[j + 1] === "'") j += 4;
        else if (src[j] && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}') j += 1;
        i = j;
        continue;
      }
      let j = i + 1;
      if (src[j] === '*') {
        i = j + 1;
        continue;
      }
      let word = '';
      while (j < src.length && /[A-Za-z]/.test(src[j]!)) {
        word += src[j];
        j += 1;
      }
      if (src[j] === '-') j += 1;
      while (j < src.length && /[0-9]/.test(src[j]!)) j += 1;
      if (src[j] === ' ') j += 1;
      if (!skipping) {
        if (word === 'par' || word === 'line') out += '\n';
        else if (word === 'tab') out += '\t';
      }
      i = j;
      continue;
    }
    if (c === '\r' || c === '\n') {
      i += 1;
      continue;
    }
    if (!skipping) out += c;
    i += 1;
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** RFC-style commas and quotes. A trailing newline does not add a row. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const pushRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      pushRow();
      continue;
    }
    cell += c;
  }
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

interface TextBlock {
  text: string;
  size: number;
  bold: boolean;
  gap: number;
}

function markdownBlocks(src: string): TextBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: TextBlock[] = [];
  let paragraph = '';
  const flush = () => {
    const text = inlineMarkdown(paragraph).trim();
    if (text) blocks.push({ text, size: 11, bold: false, gap: 8 });
    paragraph = '';
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^(\s*[-*+]|\s*\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      const level = heading[1]!.length;
      blocks.push({
        text: inlineMarkdown(heading[2] ?? ''),
        size: level === 1 ? 20 : level === 2 ? 16 : 13,
        bold: true,
        gap: 8,
      });
      continue;
    }
    if (bullet) {
      flush();
      blocks.push({ text: `- ${inlineMarkdown(bullet[2] ?? '')}`, size: 11, bold: false, gap: 4 });
      continue;
    }
    paragraph = paragraph ? `${paragraph} ${line.trim()}` : line.trim();
  }
  flush();
  return blocks;
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt.trim() ? `[image: ${alt.trim()}]` : '[image]'))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2');
}

function drawable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || ch === '\t') {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrapLine(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  const push = (line: string) => {
    if (line) lines.push(line);
  };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    push(current);
    current = '';
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      const trial = piece + ch;
      if (piece && font.widthOfTextAtSize(trial, size) > maxWidth) {
        lines.push(piece);
        piece = ch;
      } else piece = trial;
    }
    current = piece;
  }
  push(current);
  return lines;
}

interface Writer {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

function newWriter(doc: PDFDocument, regular: PDFFont, bold: PDFFont): Writer {
  const page = doc.addPage([CONVERT_PAGE.width, CONVERT_PAGE.height]);
  return { doc, regular, bold, page, y: CONVERT_PAGE.height - MARGIN };
}

function nextPage(writer: Writer): void {
  if (writer.doc.getPageCount() >= MAX_PAGES) throw new Error('That file is too long to turn into one PDF here.');
  writer.page = writer.doc.addPage([CONVERT_PAGE.width, CONVERT_PAGE.height]);
  writer.y = CONVERT_PAGE.height - MARGIN;
}

async function drawBlocks(writer: Writer, blocks: readonly TextBlock[]): Promise<void> {
  const maxWidth = CONVERT_PAGE.width - MARGIN * 2;
  for (const block of blocks) {
    const font = block.bold ? writer.bold : writer.regular;
    const lines = wrapLine(font, drawable(font, block.text), block.size, maxWidth);
    for (const line of lines) {
      const lead = block.size + 4;
      if (writer.y - lead < MARGIN) nextPage(writer);
      writer.page.drawText(line, {
        x: MARGIN,
        y: writer.y - block.size,
        size: block.size,
        font,
        color: rgb(0.11, 0.11, 0.12),
      });
      writer.y -= lead;
    }
    writer.y -= block.gap;
  }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

async function drawImage(doc: PDFDocument, bytes: Uint8Array): Promise<void> {
  const image = isJpeg(bytes) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const page = doc.addPage([CONVERT_PAGE.width, CONVERT_PAGE.height]);
  const maxW = CONVERT_PAGE.width - 72;
  const maxH = CONVERT_PAGE.height - 72;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (CONVERT_PAGE.width - width) / 2,
    y: (CONVERT_PAGE.height - height) / 2,
    width,
    height,
  });
}

function fitCell(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = drawable(font, text.replace(/\s+/g, ' ').trim());
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let out = safe;
  while (out.length > 0 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) out = out.slice(0, -1);
  return out ? `${out}...` : '';
}

async function drawCsv(doc: PDFDocument, regular: PDFFont, bold: PDFFont, rows: string[][]): Promise<void> {
  const columns = Math.max(...rows.map((row) => row.length));
  const width = CONVERT_PAGE.width - MARGIN * 2;
  const colW = width / columns;
  const rowH = 18;
  const size = colW < 48 ? 8 : 10;
  let page = doc.addPage([CONVERT_PAGE.width, CONVERT_PAGE.height]);
  let y = CONVERT_PAGE.height - MARGIN;
  const drawRow = (row: string[], header: boolean) => {
    if (y - rowH < MARGIN) {
      if (doc.getPageCount() >= MAX_PAGES) throw new Error('That file is too long to turn into one PDF here.');
      page = doc.addPage([CONVERT_PAGE.width, CONVERT_PAGE.height]);
      y = CONVERT_PAGE.height - MARGIN;
    }
    const font = header ? bold : regular;
    if (header) {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH,
        width,
        height: rowH,
        color: rgb(0.93, 0.94, 0.96),
      });
    }
    for (let col = 0; col < columns; col += 1) {
      const x = MARGIN + col * colW;
      page.drawLine({
        start: { x, y },
        end: { x, y: y - rowH },
        thickness: 0.4,
        color: rgb(0.8, 0.82, 0.85),
      });
      const text = fitCell(font, row[col] ?? '', size, colW - 8);
      if (text) {
        page.drawText(text, { x: x + 4, y: y - rowH + 5, size, font, color: rgb(0.11, 0.11, 0.12) });
      }
    }
    page.drawLine({
      start: { x: MARGIN, y: y - rowH },
      end: { x: MARGIN + width, y: y - rowH },
      thickness: 0.4,
      color: rgb(0.8, 0.82, 0.85),
    });
    y -= rowH;
  };
  rows.forEach((row, index) => drawRow(row, index === 0));
}

export interface ConvertFile {
  name: string;
  text?: string;
  /** JPEG or PNG bytes. HEIC and the other image types are decoded on the phone first. */
  image?: Uint8Array;
  pdf?: Uint8Array;
}

export interface ConvertedItem {
  name: string;
  formatId: string;
  label: string;
  reliability: ConvertReliability;
  included: boolean;
  deviceRender: DeviceRender;
  note: string;
}

export interface ConvertedPdf {
  bytes: Uint8Array;
  pages: number;
}

/**
 * One PDF, in the order the files were given. A file that needs the phone
 * or the network is listed and left out of the bytes. Office files are
 * listed and left out. The buffers passed in are not modified.
 */
export async function convertFilesToPdf(
  files: readonly ConvertFile[],
): Promise<{ pdf: ConvertedPdf | null; items: ConvertedItem[] }> {
  if (files.length === 0) throw new Error('Choose a file.');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const items: ConvertedItem[] = [];

  for (const file of files) {
    const plan = describeFile(file.name, file.text);
    const started = doc.getPageCount();
    let included = false;
    let note = plan.note;
    try {
      included = await appendFile(doc, regular, bold, file, plan);
    } catch (error) {
      note = error instanceof Error ? error.message : 'This file could not be converted.';
      if (doc.getPageCount() > started) throw error;
    }
    if (!included && note === plan.note && plan.deviceRender === 'none' && plan.reliability === 'reliable') {
      note = 'Nothing in this file could be placed on a page.';
    }
    items.push({
      name: file.name,
      formatId: plan.formatId,
      label: plan.label,
      reliability: plan.reliability,
      included,
      deviceRender: plan.deviceRender,
      note,
    });
  }

  if (doc.getPageCount() === 0) return { pdf: null, items };
  const bytes = await doc.save({ useObjectStreams: true });
  return { pdf: { bytes, pages: doc.getPageCount() }, items };
}

async function appendFile(
  doc: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  file: ConvertFile,
  plan: FilePlan,
): Promise<boolean> {
  if (plan.reliability === 'not-reliable' || plan.reliability === 'online') return false;
  if (plan.formatId === 'html' || plan.formatId === 'webarchive' || plan.formatId === 'weblink') return false;
  if (plan.formatId === 'pdf') {
    if (!file.pdf) return false;
    const src = await PDFDocument.load(file.pdf.slice(), { ignoreEncryption: true });
    const copied = await doc.copyPages(src, src.getPageIndices());
    for (const page of copied) doc.addPage(page);
    return copied.length > 0;
  }
  if (plan.formatId === 'jpeg' || plan.formatId === 'png') {
    if (!file.image || !(isJpeg(file.image) || isPng(file.image))) return false;
    await drawImage(doc, file.image);
    return true;
  }
  if (plan.deviceRender === 'imageio') return false;
  if (plan.formatId === 'csv') {
    const rows = parseCsv(file.text ?? '');
    if (rows.length === 0) return false;
    await drawCsv(doc, regular, bold, rows);
    return true;
  }
  if (plan.formatId === 'text' || plan.formatId === 'markdown' || plan.formatId === 'rtf') {
    const raw = plan.formatId === 'rtf' ? rtfToPlain(file.text ?? '') : (file.text ?? '');
    const blocks =
      plan.formatId === 'markdown'
        ? markdownBlocks(raw)
        : raw
            .split(/\n{2,}/)
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .map((text) => ({ text, size: 11, bold: false, gap: 8 }));
    if (blocks.length === 0) return false;
    await drawBlocks(newWriter(doc, regular, bold), blocks);
    return true;
  }
  return false;
}

/** Join PDFs that are already PDF bytes. Order is the order of `parts`. */
export async function combinePdfBytes(parts: readonly Uint8Array[]): Promise<ConvertedPdf> {
  if (parts.length === 0) throw new Error('Nothing to combine.');
  const doc = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part.slice(), { ignoreEncryption: true });
    const copied = await doc.copyPages(src, src.getPageIndices());
    for (const page of copied) doc.addPage(page);
  }
  if (doc.getPageCount() === 0) throw new Error('Nothing to combine.');
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount() };
}
