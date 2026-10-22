// QR maker history. Pure list operations: the caller persists the result
// on device (App Group + AsyncStorage). Nothing here talks to the network.

import type { QrContentType, QrHistoryItem, QrStyle } from '../types';

export const MAX_QR_HISTORY = 100;

function inkHex(r: number, g: number, b: number): string {
  const channel = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export const DEFAULT_QR_STYLE: QrStyle = {
  foreground: inkHex(0, 0, 0),
  background: inkHex(255, 255, 255),
};

const CONTENT_TYPES = new Set<QrContentType>([
  'url',
  'text',
  'wifi',
  'contact',
  'email',
  'phone',
]);

export interface QrSaveInput {
  direction: 'made' | 'scanned';
  payload: string;
  kind?: string;
  type?: QrContentType;
  style?: Partial<QrStyle> | null;
}

export function qrContentType(payload: string): QrContentType {
  if (/^WIFI:/i.test(payload)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(payload)) return 'contact';
  if (/^https?:\/\//i.test(payload)) return 'url';
  if (/^mailto:/i.test(payload)) return 'email';
  if (/^tel:/i.test(payload)) return 'phone';
  return 'text';
}

export function qrTypeLabel(type: QrContentType): string {
  switch (type) {
    case 'url':
      return 'URL';
    case 'wifi':
      return 'Wi-Fi';
    case 'contact':
      return 'Contact';
    case 'email':
      return 'Email';
    case 'phone':
      return 'Phone';
    default:
      return 'Text';
  }
}

/** One line a history row can show: SSID, contact name, or the payload. */
export function qrContentPreview(payload: string): string {
  if (/^WIFI:/i.test(payload)) {
    const ssid = payload.match(/(?:^|;)S:((?:\\.|[^;])*)/i);
    if (ssid?.[1]) return ssid[1].replace(/\\(.)/g, '$1');
  }
  const name = payload.match(/^FN:(.*)$/m);
  if (name?.[1]) return name[1].replace(/\\n/g, ' ').replace(/\\(.)/g, '$1');
  return payload.replace(/\s+/g, ' ').trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatQrDate(ms: number): string {
  const d = new Date(ms);
  const month = MONTHS[d.getMonth()] ?? 'Jan';
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

function styleOf(style?: Partial<QrStyle> | null): QrStyle {
  const foreground = typeof style?.foreground === 'string' ? style.foreground.trim() : '';
  const background = typeof style?.background === 'string' ? style.background.trim() : '';
  return {
    foreground: foreground || DEFAULT_QR_STYLE.foreground,
    background: background || DEFAULT_QR_STYLE.background,
  };
}

function newestFirst(items: QrHistoryItem[]): QrHistoryItem[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
}

function bounded(items: QrHistoryItem[]): QrHistoryItem[] {
  return newestFirst(items).slice(0, MAX_QR_HISTORY);
}

function sameCode(a: { direction: string; payload: string }, b: { direction: string; payload: string }): boolean {
  return a.direction === b.direction && a.payload === b.payload;
}

/**
 * Save a generated (or scanned) code. The same direction and payload
 * moves to the top and keeps its id; style and label are updated.
 * Past 100, the oldest entries are dropped.
 */
export function saveQrHistory(
  items: QrHistoryItem[],
  input: QrSaveInput,
  now: number = Date.now(),
  id: string = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): { items: QrHistoryItem[]; item: QrHistoryItem | null } {
  if (!input.payload.trim()) return { items, item: null };
  const type = input.type ?? qrContentType(input.payload);
  const kind = input.kind?.trim() || qrTypeLabel(type);
  const style = styleOf(input.style);
  const existing = items.find((q) => sameCode(q, input));
  const item: QrHistoryItem = existing
    ? { ...existing, kind, type, style, createdAt: now }
    : {
        id,
        direction: input.direction,
        kind,
        type,
        payload: input.payload,
        style,
        createdAt: now,
      };
  const rest = items.filter((q) => q.id !== item.id && !sameCode(q, input));
  return { items: bounded([item, ...rest]), item };
}

export function deleteQrHistoryItem(items: QrHistoryItem[], id: string): QrHistoryItem[] {
  return items.filter((q) => q.id !== id);
}

/** Put a deleted row back. The same id is kept so a second import does not duplicate it. */
export function restoreQrHistoryItem(items: QrHistoryItem[], item: QrHistoryItem): QrHistoryItem[] {
  if (items.some((q) => q.id === item.id)) return items;
  return bounded([item, ...items]);
}

/** Combine two on-device copies. Identical content keeps the newer row. */
export function mergeQrHistory(primary: QrHistoryItem[], extra: QrHistoryItem[]): QrHistoryItem[] {
  const byKey = new Map<string, QrHistoryItem>();
  for (const item of [...extra, ...primary]) {
    const key = `${item.direction}\n${item.payload}`;
    const prev = byKey.get(key);
    if (!prev || item.createdAt >= prev.createdAt) byKey.set(key, item);
  }
  return bounded([...byKey.values()]);
}

/** Drop junk and fill type/style on rows saved before those fields existed. */
export function normalizeQrHistory(raw: unknown): QrHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items: QrHistoryItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Partial<QrHistoryItem>;
    if (typeof row.id !== 'string' || !row.id.trim()) continue;
    if (typeof row.payload !== 'string' || !row.payload.trim()) continue;
    const direction = row.direction === 'scanned' ? 'scanned' : 'made';
    const createdAt =
      typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : 0;
    const type = row.type && CONTENT_TYPES.has(row.type) ? row.type : qrContentType(row.payload);
    const kind = typeof row.kind === 'string' && row.kind.trim() ? row.kind : qrTypeLabel(type);
    const styleRaw = row.style;
    const style = styleOf(
      styleRaw && typeof styleRaw === 'object'
        ? {
            foreground: typeof styleRaw.foreground === 'string' ? styleRaw.foreground : '',
            background: typeof styleRaw.background === 'string' ? styleRaw.background : '',
          }
        : null,
    );
    items.push({ id: row.id, direction, kind, type, payload: row.payload, style, createdAt });
  }
  return mergeQrHistory(items, []);
}
