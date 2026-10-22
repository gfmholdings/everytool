// When a made QR is written to on-device history, and what a fresh type shows.
// Photos stays a separate Share / Save action. Nothing here talks to the network.

export const QR_AUTOSAVE_MS = 600;

export type MakerKind = 'text' | 'wifi' | 'contact';
export type MakerSecurity = 'WPA' | 'WEP' | 'nopass';

export interface MakerFields {
  kind: MakerKind;
  text: string;
  ssid: string;
  password: string;
  security: MakerSecurity;
  name: string;
  phone: string;
  email: string;
}

export function emptyMaker(kind: MakerKind = 'text'): MakerFields {
  return {
    kind,
    text: '',
    ssid: '',
    password: '',
    security: 'WPA',
    name: '',
    phone: '',
    email: '',
  };
}

function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"'])/g, '\\$1');
}

function wifiString(ssid: string, password: string, security: MakerSecurity): string {
  const parts = [`T:${security}`, `S:${escapeWifi(ssid)}`];
  if (security !== 'nopass') parts.push(`P:${escapeWifi(password)}`);
  return `WIFI:${parts.join(';')};;`;
}

function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function contactString(name: string, phone: string, email: string): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(name)}`];
  if (phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(phone)}`);
  if (email) lines.push(`EMAIL:${escapeVCard(email)}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

/** Payload for the current fields, or null when that type has nothing to encode. */
export function payloadFor(fields: MakerFields): string | null {
  if (fields.kind === 'text') return fields.text.trim() ? fields.text : null;
  if (fields.kind === 'wifi') {
    return fields.ssid.trim() ? wifiString(fields.ssid, fields.password, fields.security) : null;
  }
  return fields.name.trim() ? contactString(fields.name, fields.phone, fields.email) : null;
}

/** The QR on screen. An empty type shows nothing from the previous type. */
export function displayedQr(fields: MakerFields): string | null {
  return payloadFor(fields);
}

/**
 * Text / link, Wi-Fi, and Contact each start empty. The previous code is
 * already in History; its text, network, and contact fields do not carry over.
 */
export function switchMakerKind(fields: MakerFields, next: MakerKind): MakerFields {
  if (fields.kind === next) return fields;
  return emptyMaker(next);
}

export interface AutosaveInput {
  payload: string | null;
  lastSaved: string | null;
  /** How long this payload has stayed unchanged. */
  quietMs: number;
  /** Leaving the type, the Make tab, or the QR tool commits immediately. */
  leaving: boolean;
  debounceMs?: number;
}

export interface AutosaveDecision {
  /** Payload to append to history, or null when this moment should not write. */
  save: string | null;
  lastSaved: string | null;
}

/**
 * One history write per settled code. Keystrokes inside the quiet window
 * do not write. Leaving, or the same payload again, does not stack copies
 * from this session; a later session still passes the payload through so
 * history can move that row to the top.
 */
export function autosaveDecision(input: AutosaveInput): AutosaveDecision {
  const payload = input.payload && input.payload.trim() ? input.payload : null;
  const debounce = input.debounceMs ?? QR_AUTOSAVE_MS;
  if (!payload) return { save: null, lastSaved: input.lastSaved };
  if (payload === input.lastSaved) return { save: null, lastSaved: input.lastSaved };
  if (!input.leaving && input.quietMs < debounce) {
    return { save: null, lastSaved: input.lastSaved };
  }
  return { save: payload, lastSaved: payload };
}
