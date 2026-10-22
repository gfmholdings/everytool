// Split-bill math in integer cents. Floats never touch money: the total,
// tax and tip are rounded to cents once, and the per-person shares are
// dealt out cent-by-cent so they always sum back to the grand total
// exactly (the first `remainder` people pay one cent more).

export interface BillSplit {
  totalCents: number;
  taxCents: number;
  tipCents: number;
  grandCents: number;
  /** One entry per person; sums exactly to grandCents. */
  sharesCents: number[];
}

export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars < 0) return 0;
  return Math.round(dollars * 100);
}

/** tipPercent may be fractional (e.g. 17.5). Tip is on the pre-tax total. */
export function splitBill(
  totalDollars: number,
  taxDollars: number,
  tipPercent: number,
  people: number,
): BillSplit {
  const totalCents = toCents(totalDollars);
  const taxCents = toCents(taxDollars);
  const tipCents = Math.round((totalCents * Math.max(0, tipPercent)) / 100);
  const grandCents = totalCents + taxCents + tipCents;
  const n = Math.max(1, Math.floor(people) || 1);
  const base = Math.floor(grandCents / n);
  const remainder = grandCents - base * n;
  const sharesCents = Array.from({ length: n }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
  return { totalCents, taxCents, tipCents, grandCents, sharesCents };
}

const PEOPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Plain text for the native share sheet. Not a file. */
export function evenBillShareText(input: {
  people: number;
  tipCents: number;
  grandCents: number;
  sharesCents: number[];
}): string {
  const lines = [
    'Split bill',
    `Total with tax and tip: ${formatMoney(input.grandCents)}`,
    `Tip: ${formatMoney(input.tipCents)}`,
  ];
  const groups = new Map<number, number>();
  for (const cents of input.sharesCents) groups.set(cents, (groups.get(cents) ?? 0) + 1);
  if (groups.size <= 1) {
    lines.push(`Each of ${input.people}: ${formatMoney(input.sharesCents[0] ?? 0)}`);
  } else {
    for (const [cents, count] of groups) {
      lines.push(`${count} ${count === 1 ? 'person pays' : 'people pay'} ${formatMoney(cents)}`);
    }
  }
  return lines.join('\n');
}

/** Plain text for an itemized split. One line per person. */
export function itemBillShareText(perPerson: number[]): string {
  const lines = ['Split bill'];
  let total = 0;
  perPerson.forEach((cents, i) => {
    total += cents;
    lines.push(`Person ${PEOPLE[i] ?? i + 1} pays ${formatMoney(cents)}`);
  });
  lines.push(`Total: ${formatMoney(total)}`);
  return lines.join('\n');
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${rest}`;
}
