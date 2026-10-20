// Look before you open: a plain-words safety read of a scanned link.
// Pure string checks (no network) — the point is to show the user where
// a QR code really goes and flag the classic tricks, not to guarantee a
// site is safe.

export interface LinkCheck {
  /** 'url' for http(s) links; other kinds are opened/copied as before. */
  kind: 'url' | 'mailto' | 'tel' | 'other';
  /** The host shown big ("example.com"), lowercased. */
  host: string | null;
  warnings: string[];
  /** True when any warning is present. */
  risky: boolean;
}

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly',
  'rebrand.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'qrco.de', 's.id', 'v.gd', 't.ly',
]);
const ODD_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'ml', 'cf', 'work', 'rest']);
const BRANDS = ['paypal', 'apple', 'icloud', 'google', 'microsoft', 'amazon', 'netflix', 'bank', 'chase', 'wellsfargo', 'usps', 'fedex', 'dhl', 'irs', 'gov'];

export function checkLink(raw: string): LinkCheck {
  const text = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme === 'mailto') return { kind: 'mailto', host: null, warnings: [], risky: false };
  if (scheme === 'tel' || scheme === 'sms') return { kind: 'tel', host: null, warnings: [], risky: false };
  if (scheme !== 'http' && scheme !== 'https') {
    const warnings =
      scheme && ['javascript', 'data', 'file', 'itms-services', 'intent'].includes(scheme)
        ? ['Unusual link type — it could run code or install something.']
        : [];
    return { kind: 'other', host: null, warnings, risky: warnings.length > 0 };
  }

  const m = /^https?:\/\/([^/?#]*)/i.exec(text);
  const authority = m?.[1] ?? '';
  const warnings: string[] = [];
  let hostPort = authority;
  if (authority.includes('@')) {
    warnings.push('The part before “@” is a disguise — the link really goes to the address after it.');
    hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  }
  let host = hostPort;
  let port = '';
  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPort);
  if (ipv6) {
    host = ipv6[1]!;
    port = ipv6[2] ?? '';
  } else if (/:\d+$/.test(hostPort)) {
    port = hostPort.slice(hostPort.lastIndexOf(':') + 1);
    host = hostPort.slice(0, hostPort.lastIndexOf(':'));
  }
  host = host.toLowerCase().replace(/\.$/, '');

  if (scheme === 'http') warnings.push('Not secure (http) — anything you type can be read on the way.');
  if (!host) warnings.push('This link has no website address.');
  if (ipv6 || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    warnings.push('Goes to a bare IP address instead of a named website.');
  }
  if (host.split('.').some((l) => l.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)) {
    warnings.push('Uses look-alike characters — the name may imitate a different site.');
  }
  if (SHORTENERS.has(host)) warnings.push('Shortened link — the real destination is hidden.');
  const labels = host.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (ODD_TLDS.has(tld)) warnings.push(`Unusual ending “.${tld}”, common in scam links.`);
  // "bbc.co.uk": a 2-letter country code under co/com/org/… is one suffix.
  const twoLevel =
    labels.length >= 3 &&
    tld.length === 2 &&
    ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'gob', 'or', 'ne'].includes(labels[labels.length - 2]!);
  const keep = twoLevel ? 3 : 2;
  const registrable = labels.slice(-keep).join('.');
  const front = labels.slice(0, -keep).join('.');
  const tokens = front.split(/[.-]/);
  const brand = BRANDS.find((b) => tokens.includes(b) && !registrable.split(/[.-]/).includes(b));
  if (brand || /\.(com|net|org)\./.test(`${front}.`)) {
    warnings.push(`Looks like “${brand ?? front}” but the site is really ${registrable}.`);
  }
  if (port && port !== '80' && port !== '443') warnings.push(`Uses an unusual port (${port}).`);
  if (text.length > 300) warnings.push('Very long link — often used to hide where it goes.');
  return { kind: 'url', host: host || null, warnings, risky: warnings.length > 0 };
}
