// Receipt scanning for Split bill — pure, unit-tested.
// The app recognises text on-device (Apple Vision, see the native
// module's recognizeText) and passes the boxes here: they are grouped
// into printed lines, prices are read off the right, and lines are
// classified as items, subtotal, tax, tip or total. Splitting by item is
// integer cents with exact remainders, like splitBill.

export interface TextBox {
  text: string;
  /** Normalised 0–1, origin top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Group recognised boxes into printed lines, left to right. */
export function linesFromBoxes(boxes: TextBox[]): string[] {
  const sorted = [...boxes].filter((b) => b.text.trim()).sort((a, b) => a.y - b.y);
  const rows: TextBox[][] = [];
  for (const b of sorted) {
    const mid = b.y + b.height / 2;
    const row = rows.find((r) => {
      const ref = r[0]!;
      const refMid = ref.y + ref.height / 2;
      return Math.abs(refMid - mid) < Math.max(ref.height, b.height) * 0.5;
    });
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows.map((r) =>
    r
      .sort((a, b) => a.x - b.x)
      .map((b) => b.text.trim())
      .join(' '),
  );
}

export interface ReceiptItem {
  name: string;
  cents: number;
}

export interface ParsedReceipt {
  items: ReceiptItem[];
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
}

const PRICE_AT_END = /(-?)\$?\s?(\d{1,5}(?:[,\s]\d{3})*)[.,](\d{2})\s*-?\s*[A-Z*]{0,2}\s*$/;
const SKIP =
  /\b(change|cash|visa|mastercard|master card|amex|debit|credit|card|tender|payment|paid|balance due|auth|approval|ref|acct|account|tel|phone|www|thank)/i;

function cents(sign: string, whole: string, frac: string): number {
  const v = Number(whole.replace(/[,\s]/g, '')) * 100 + Number(frac);
  return sign === '-' ? -v : v;
}

export function parseReceipt(lines: string[]): ParsedReceipt {
  const out: ParsedReceipt = {
    items: [],
    subtotalCents: null,
    taxCents: null,
    tipCents: null,
    totalCents: null,
  };
  let afterTotal = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const m = PRICE_AT_END.exec(line);
    if (!m) continue;
    const value = cents(m[1]!, m[2]!, m[3]!);
    const label = line.slice(0, m.index).replace(/[.:$\s]+$/, '').trim();
    const l = label.toLowerCase();
    if (/sub\s?-?total/.test(l)) {
      out.subtotalCents = value;
    } else if (/\b(tax|vat|gst|hst|pst)\b/.test(l)) {
      out.taxCents = (out.taxCents ?? 0) + value;
    } else if (/\b(tip|gratuity|service charge|service)\b/.test(l)) {
      out.tipCents = (out.tipCents ?? 0) + value;
    } else if (/\b(total|amount due|grand total|to pay)\b/.test(l)) {
      out.totalCents = value;
      afterTotal = true;
    } else if (SKIP.test(l) || afterTotal || !/[a-z]/i.test(label)) {
      continue;
    } else {
      // "2 x Burger" / "2 Burger" stays one line item with its line price.
      const name = label.replace(/^\d+\s*[x@]?\s+/i, (q) => q).trim();
      out.items.push({ name, cents: value });
    }
  }
  return out;
}

export interface ItemSplit {
  /** Per person, exact; sums to grand total. */
  perPerson: number[];
  itemsCents: number;
  taxCents: number;
  tipCents: number;
  grandCents: number;
}

/** Deal `total` cents across weights exactly (largest remainder). */
export function prorate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    return weights.map((_, i) => base + (i < total - base * weights.length ? 1 : 0));
  }
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/**
 * Split by item. `assign[k]` lists the people (0-based) sharing item k;
 * an empty list means everyone shares it. Tax and tip follow each
 * person's share of the items.
 */
export function splitByItems(
  items: ReceiptItem[],
  assign: number[][],
  people: number,
  taxCents: number,
  tip: { percent: number } | { cents: number },
): ItemSplit {
  const n = Math.max(1, Math.floor(people));
  const shares = new Array<number>(n).fill(0);
  items.forEach((item, k) => {
    const who = (assign[k] ?? []).filter((p) => p >= 0 && p < n);
    const group = who.length > 0 ? [...new Set(who)].sort((a, b) => a - b) : Array.from({ length: n }, (_, i) => i);
    prorate(item.cents, group.map(() => 1)).forEach((c, j) => {
      shares[group[j]!]! += c;
    });
  });
  const itemsCents = items.reduce((a, b) => a + b.cents, 0);
  const tipCents = 'cents' in tip ? tip.cents : Math.round((itemsCents * Math.max(0, tip.percent)) / 100);
  const weights = shares.map((s) => Math.max(0, s));
  const taxShare = prorate(Math.max(0, taxCents), weights);
  const tipShare = prorate(Math.max(0, tipCents), weights);
  const perPerson = shares.map((s, i) => s + taxShare[i]! + tipShare[i]!);
  return {
    perPerson,
    itemsCents,
    taxCents: Math.max(0, taxCents),
    tipCents: Math.max(0, tipCents),
    grandCents: perPerson.reduce((a, b) => a + b, 0),
  };
}
