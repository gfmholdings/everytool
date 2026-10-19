// QR payload builders for the kinds Everytool creates. Wi-Fi uses the
// de-facto WIFI: format every phone camera understands; contact uses
// vCard 3.0. Special characters are escaped per each format's rules.

function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"'])/g, '\\$1');
}

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

export function wifiPayload(
  ssid: string,
  password: string,
  security: WifiSecurity = 'WPA',
  hidden = false,
): string {
  const parts = [`T:${security}`, `S:${escapeWifi(ssid)}`];
  if (security !== 'nopass') parts.push(`P:${escapeWifi(password)}`);
  if (hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export interface ContactFields {
  name: string;
  phone?: string;
  email?: string;
  org?: string;
}

export function contactPayload(c: ContactFields): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(c.name)}`];
  if (c.phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${escapeVCard(c.email)}`);
  if (c.org) lines.push(`ORG:${escapeVCard(c.org)}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

/** A plain-words label for a scanned payload, for the history list. */
export function describePayload(payload: string): string {
  if (/^WIFI:/i.test(payload)) return 'Wi-Fi network';
  if (/^BEGIN:VCARD/i.test(payload)) return 'Contact';
  if (/^https?:\/\//i.test(payload)) return 'Link';
  if (/^mailto:/i.test(payload)) return 'Email address';
  if (/^tel:/i.test(payload)) return 'Phone number';
  return 'Text';
}
