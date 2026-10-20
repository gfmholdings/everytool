export type ToolId =
  | 'stitch'
  | 'clipboard'
  | 'convert'
  | 'qr'
  | 'resize'
  | 'pdf'
  | 'text'
  | 'days'
  | 'split'
  | 'gif';

export interface ToolDef {
  id: ToolId;
  name: string;
  glyph: string; // SF Symbol name on iOS, drawn by ToolGlyph
}

export const TOOLS: ToolDef[] = [
  { id: 'stitch', name: 'Long screenshot', glyph: 'rectangle.expand.vertical' },
  { id: 'clipboard', name: 'Clipboard', glyph: 'clipboard' },
  { id: 'convert', name: 'Convert', glyph: 'arrow.triangle.2.circlepath' },
  { id: 'qr', name: 'QR toolbox', glyph: 'qrcode' },
  { id: 'resize', name: 'Resize photo', glyph: 'arrow.down.right.and.arrow.up.left' },
  { id: 'pdf', name: 'PDF tools', glyph: 'doc' },
  { id: 'text', name: 'Text tools', glyph: 'text.alignleft' },
  { id: 'days', name: 'Days counter', glyph: 'calendar' },
  { id: 'split', name: 'Split bill', glyph: 'person.2' },
  { id: 'gif', name: 'Video to GIF', glyph: 'photo.stack' },
];

/** One saved clipboard item. Lives in the shared App Group store so the
 *  app and the keyboard extension read the same vault. */
export interface Clip {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: number;
  /** Optional snippet word: typing it + space in the keyboard expands to `text`. */
  shortcut?: string;
}

/** A saved countdown, shown in the Days counter and the widgets. */
export interface Countdown {
  id: string;
  title: string;
  /** Local-midnight date of the event, ms since epoch. */
  date: number;
  createdAt: number;
}

export interface QrHistoryItem {
  id: string;
  direction: 'made' | 'scanned';
  kind: string; // "Text" / "Wi-Fi network" / "Contact" / "Link" …
  payload: string;
  createdAt: number;
}

export interface AppState {
  clips: Clip[];
  qrHistory: QrHistoryItem[];
  countdowns: Countdown[];
}

export const emptyState: AppState = { clips: [], qrHistory: [], countdowns: [] };
