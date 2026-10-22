// Offline Splitwise-style groups. Pure and import-free so the Node test
// runner can load this file alone. Not wired into the live Split bill
// screen: that screen keeps its even / by-item flow until this UI is approved.
//
// Money is integer cents. Equal splits deal leftover cents to the first
// people in line order. Percent, shares, tax and tip use largest-remainder
// so the parts always sum back to the total. Percents are basis points
// (10_000 = 100%). A percent charge is of the item subtotal, not of tax.

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares' | 'adjustment';
export type ChargeKind = 'percent' | 'amount';

export interface Person {
  id: string;
  name: string;
  isYou?: boolean;
}

export interface SplitGroup {
  id: string;
  name: string;
  currency: CurrencyCode;
  people: Person[];
  createdAt: number;
}

export interface SplitLine {
  personId: string;
  /** Equal: ignored (presence means in). Exact: cents. Percent: basis points. Shares: weight. Adjustment: signed cents. */
  value: number;
}

export interface Payer {
  personId: string;
  cents: number;
}

export interface Charge {
  kind: ChargeKind;
  /** Percent: basis points of the item subtotal. Amount: cents. */
  value: number;
}

export interface ReceiptItem {
  id: string;
  name: string;
  cents: number;
  /** Empty means everyone in `everyoneIds` shares it. */
  personIds: string[];
}

export interface ReceiptSplit {
  items: ReceiptItem[];
  tax: Charge;
  tip: Charge;
  /** Frozen participant list. Empty item assignments mean this whole list. */
  everyoneIds: string[];
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: CurrencyCode;
  payers: Payer[];
  split: { method: SplitMethod; lines: SplitLine[] };
  /** Set for itemized expenses. Balances recompute from this, not from later group edits. */
  receipt?: ReceiptSplit;
  createdAt: number;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  cents: number;
  currency: CurrencyCode;
  createdAt: number;
}

export interface SplitLedger {
  groups: SplitGroup[];
  expenses: Expense[];
  settlements: Settlement[];
}

export type LedgerResult =
  | { ok: true; ledger: SplitLedger }
  | { ok: false; ledger: SplitLedger; error: string };

export interface ShareAmount {
  personId: string;
  cents: number;
}

export interface SplitPreview {
  /**
   * Save gate. Exact and percent are ok only when the entry covers the
   * expense. Adjustment can be ok while `remainingCents` is still the
   * pool that was split equally on top of the +/- amounts.
   */
  ok: boolean;
  /**
   * Positive: still unallocated (or, for a valid adjustment, the equal pool).
   * Negative: over.
   */
  remainingCents: number;
  /** Percentages only. Positive left, negative over. 10_000 = 100%. */
  remainingBps: number | null;
  message: string;
  /** Line order. Sums to the expense whenever `ok`. */
  shares: ShareAmount[];
}

export interface PayerPreview {
  ok: boolean;
  remainingCents: number;
  message: string;
}

export interface ItemPreview {
  ok: boolean;
  message: string;
  itemsCents: number;
  taxCents: number;
  tipCents: number;
  grandCents: number;
  shares: ShareAmount[];
  itemShares: ShareAmount[];
  taxShares: ShareAmount[];
  tipShares: ShareAmount[];
}

export interface PersonBalance {
  personId: string;
  name: string;
  isYou: boolean;
  currency: CurrencyCode;
  /** Positive: this person is owed money. Negative: they owe. */
  netCents: number;
}

export interface DebtTransfer {
  fromId: string;
  toId: string;
  cents: number;
  currency: CurrencyCode;
}

export interface OweLine {
  fromId: string;
  toId: string;
  cents: number;
  currency: CurrencyCode;
  text: string;
}

const SYMBOL: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
};

export function emptyLedger(): SplitLedger {
  return { groups: [], expenses: [], settlements: [] };
}

export function formatCents(cents: number, currency: CurrencyCode = 'USD'): string {
  const symbol = SYMBOL[currency] ?? SYMBOL.USD;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol}${grouped}.${rest}`;
}

/** Trim and collapse a Contacts display name. Empty becomes null. */
export function personNameFromContact(displayName: string): string | null {
  const name = displayName.replace(/\s+/g, ' ').trim();
  return name.length > 0 ? name : null;
}

export function previewPayers(
  amountCents: number,
  payers: Payer[],
  currency: CurrencyCode = 'USD',
): PayerPreview {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return { ok: false, remainingCents: 0, message: 'Enter an amount' };
  }
  if (payers.length === 0) {
    return { ok: false, remainingCents: amountCents, message: 'Choose who paid' };
  }
  if (new Set(payers.map((p) => p.personId)).size !== payers.length) {
    return { ok: false, remainingCents: amountCents, message: 'Each person pays once' };
  }
  if (payers.some((p) => !p.personId || !Number.isInteger(p.cents) || p.cents < 0)) {
    return { ok: false, remainingCents: amountCents, message: "A payment can't be negative" };
  }
  const paid = payers.reduce((sum, p) => sum + p.cents, 0);
  const remainingCents = amountCents - paid;
  if (remainingCents > 0) {
    return {
      ok: false,
      remainingCents,
      message: `${formatCents(remainingCents, currency)} still to assign`,
    };
  }
  if (remainingCents < 0) {
    return {
      ok: false,
      remainingCents,
      message: `${formatCents(-remainingCents, currency)} over`,
    };
  }
  return { ok: true, remainingCents: 0, message: 'Paid in full' };
}

export function previewSplit(input: {
  amountCents: number;
  method: SplitMethod;
  lines: SplitLine[];
  currency?: CurrencyCode;
}): SplitPreview {
  const currency = input.currency ?? 'USD';
  const amount = input.amountCents;
  const lines = input.lines ?? [];
  const fail = (
    message: string,
    remainingCents = 0,
    remainingBps: number | null = null,
    shares: ShareAmount[] = [],
  ): SplitPreview => ({ ok: false, remainingCents, remainingBps, message, shares });

  if (!Number.isInteger(amount) || amount < 0) return fail('Enter an amount');
  if (!isMethod(input.method)) return fail('Choose a split');
  if (lines.some((line) => !line.personId)) return fail('Missing person');
  if (new Set(lines.map((line) => line.personId)).size !== lines.length) {
    return fail('Each person once');
  }

  if (input.method === 'equal') {
    if (lines.length === 0) return fail("Select who's in", amount);
    return {
      ok: true,
      remainingCents: 0,
      remainingBps: null,
      message: 'Split equally',
      shares: dealEqual(amount, lines.map((line) => line.personId)),
    };
  }

  if (input.method === 'exact') {
    if (lines.some((line) => !Number.isInteger(line.value) || line.value < 0)) {
      return fail("Amounts can't be negative");
    }
    const remainingCents = amount - lines.reduce((sum, line) => sum + line.value, 0);
    const shares = lines.map((line) => ({ personId: line.personId, cents: line.value }));
    if (remainingCents !== 0) {
      return {
        ok: false,
        remainingCents,
        remainingBps: null,
        message:
          remainingCents > 0
            ? `${formatCents(remainingCents, currency)} still to assign`
            : `${formatCents(-remainingCents, currency)} over`,
        shares,
      };
    }
    return { ok: true, remainingCents: 0, remainingBps: null, message: 'Amounts match', shares };
  }

  if (input.method === 'percent') {
    if (lines.length === 0) return fail('Add a person', amount, 10_000);
    if (lines.some((line) => !Number.isInteger(line.value) || line.value < 0)) {
      return fail("Percents can't be negative");
    }
    const sum = lines.reduce((total, line) => total + line.value, 0);
    const remainingBps = 10_000 - sum;
    const shares =
      sum > 0
        ? prorateIds(amount, lines.map((line) => line.value), idsOf(lines))
        : dealEqual(amount, idsOf(lines));
    return {
      ok: remainingBps === 0,
      remainingCents: scaleRound(amount, remainingBps),
      remainingBps,
      message:
        remainingBps === 0
          ? '100% assigned'
          : remainingBps > 0
            ? `${formatBps(remainingBps)} still to assign`
            : `${formatBps(-remainingBps)} over`,
      shares,
    };
  }

  if (input.method === 'shares') {
    if (lines.some((line) => !Number.isInteger(line.value) || line.value < 0)) {
      return fail("Shares can't be negative");
    }
    const sum = lines.reduce((total, line) => total + line.value, 0);
    if (sum <= 0) return fail('Enter at least one share', amount);
    return {
      ok: true,
      remainingCents: 0,
      remainingBps: null,
      message: 'Split by shares',
      shares: prorateIds(amount, lines.map((line) => line.value), idsOf(lines)),
    };
  }

  if (lines.some((line) => !Number.isInteger(line.value))) return fail('Enter adjustments in cents');
  if (lines.length === 0) return fail('Add a person', amount);
  const pool = amount - lines.reduce((sum, line) => sum + line.value, 0);
  if (pool < 0) {
    return {
      ok: false,
      remainingCents: pool,
      remainingBps: null,
      message: `${formatCents(-pool, currency)} over`,
      shares: lines.map((line) => ({ personId: line.personId, cents: line.value })),
    };
  }
  const shares = dealEqual(pool, idsOf(lines)).map((share, i) => ({
    personId: share.personId,
    cents: share.cents + lines[i]!.value,
  }));
  if (shares.some((share) => share.cents < 0)) {
    return {
      ok: false,
      remainingCents: pool,
      remainingBps: null,
      message: 'A share is below zero',
      shares,
    };
  }
  return {
    ok: true,
    remainingCents: pool,
    remainingBps: null,
    message: pool === 0 ? 'Adjustments match' : `${formatCents(pool, currency)} split equally`,
    shares,
  };
}

export function previewItems(input: {
  items: { cents: number; personIds: string[] }[];
  peopleIds: string[];
  tax?: Charge;
  tip?: Charge;
}): ItemPreview {
  const empty: ItemPreview = {
    ok: false,
    message: 'Add a person',
    itemsCents: 0,
    taxCents: 0,
    tipCents: 0,
    grandCents: 0,
    shares: [],
    itemShares: [],
    taxShares: [],
    tipShares: [],
  };
  const people = input.peopleIds ?? [];
  if (people.length === 0 || people.some((id) => !id)) return empty;
  if (new Set(people).size !== people.length) return { ...empty, message: 'Each person once' };
  const items = input.items ?? [];
  if (items.some((item) => !Number.isInteger(item.cents) || item.cents < 0)) {
    return { ...empty, message: "Item amounts can't be negative" };
  }
  for (const item of items) {
    const ids = item.personIds ?? [];
    if (new Set(ids).size !== ids.length) return { ...empty, message: 'Each person once on an item' };
    if (ids.some((id) => !people.includes(id))) return { ...empty, message: 'Unknown person on an item' };
  }
  const tax = chargeCents(0, input.tax);
  const tip = chargeCents(0, input.tip);
  if (!tax.ok) return { ...empty, message: tax.message };
  if (!tip.ok) return { ...empty, message: tip.message };

  const itemShares = people.map((personId) => ({ personId, cents: 0 }));
  for (const item of items) {
    const who = item.personIds.length > 0 ? item.personIds : people;
    const dealt = dealEqual(item.cents, who);
    for (const share of dealt) {
      const row = itemShares.find((entry) => entry.personId === share.personId);
      if (row) row.cents += share.cents;
    }
  }
  const itemsCents = items.reduce((sum, item) => sum + item.cents, 0);
  const taxCents = chargeCents(itemsCents, input.tax).cents;
  const tipCents = chargeCents(itemsCents, input.tip).cents;
  const weights = itemShares.map((share) => share.cents);
  const taxShares = zip(people, prorate(taxCents, weights));
  const tipShares = zip(people, prorate(tipCents, weights));
  const shares = people.map((personId, i) => ({
    personId,
    cents: itemShares[i]!.cents + taxShares[i]!.cents + tipShares[i]!.cents,
  }));
  const grandCents = itemsCents + taxCents + tipCents;
  return {
    ok: true,
    message: 'Receipt totals match',
    itemsCents,
    taxCents,
    tipCents,
    grandCents,
    shares,
    itemShares,
    taxShares,
    tipShares,
  };
}

export interface ReceiptPrefillLine {
  name: string;
  cents: number;
  role?: 'item' | 'tax' | 'tip' | 'total' | 'subtotal';
}

/** Map already-parsed on-device OCR lines into items plus tax and tip cents. */
export function prefillFromReceipt(lines: ReceiptPrefillLine[]): {
  items: { name: string; cents: number }[];
  taxCents: number;
  tipCents: number;
} {
  const items: { name: string; cents: number }[] = [];
  let taxCents = 0;
  let tipCents = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.cents) || line.cents <= 0) continue;
    if (line.role === 'total' || line.role === 'subtotal') continue;
    if (line.role === 'tax') {
      taxCents += line.cents;
      continue;
    }
    if (line.role === 'tip') {
      tipCents += line.cents;
      continue;
    }
    const name = line.name.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    items.push({ name, cents: line.cents });
  }
  return { items, taxCents, tipCents };
}

export function addGroup(
  ledger: SplitLedger,
  input: { id: string; name: string; youId: string; currency?: CurrencyCode; createdAt?: number },
): LedgerResult {
  if (!input.id || !input.youId) return { ok: false, ledger, error: 'Missing id' };
  if (ledger.groups.some((group) => group.id === input.id)) {
    return { ok: false, ledger, error: 'Group already exists' };
  }
  const currency = input.currency ?? 'USD';
  if (!isCurrency(currency)) return { ok: false, ledger, error: 'Unknown currency' };
  const group: SplitGroup = {
    id: input.id,
    name: clip(input.name, 40, 'Group'),
    currency,
    people: [{ id: input.youId, name: 'You', isYou: true }],
    createdAt: stamp(input.createdAt),
  };
  return { ok: true, ledger: { ...ledger, groups: [...ledger.groups, group] } };
}

export function addPerson(
  ledger: SplitLedger,
  groupId: string,
  person: { id: string; name: string },
): LedgerResult {
  const name = personNameFromContact(person.name);
  if (!person.id) return { ok: false, ledger, error: 'Missing id' };
  if (!name) return { ok: false, ledger, error: 'Enter a name' };
  const group = ledger.groups.find((entry) => entry.id === groupId);
  if (!group) return { ok: false, ledger, error: 'Group not found' };
  if (group.people.some((entry) => entry.id === person.id)) {
    return { ok: false, ledger, error: 'Person already added' };
  }
  const next: Person = { id: person.id, name: name.slice(0, 40) };
  return { ok: true, ledger: replaceGroup(ledger, { ...group, people: [...group.people, next] }) };
}

export function addExpense(
  ledger: SplitLedger,
  input: {
    id: string;
    groupId: string;
    description?: string;
    amountCents: number;
    currency?: CurrencyCode;
    payers: Payer[];
    split: { method: SplitMethod; lines: SplitLine[] };
    receipt?: {
      items: { id: string; name: string; cents: number; personIds: string[] }[];
      tax?: Charge;
      tip?: Charge;
      everyoneIds?: string[];
    };
    createdAt?: number;
  },
): LedgerResult {
  if (!input.id) return { ok: false, ledger, error: 'Missing id' };
  if (ledger.expenses.some((expense) => expense.id === input.id)) {
    return { ok: false, ledger, error: 'Expense already exists' };
  }
  const group = ledger.groups.find((entry) => entry.id === input.groupId);
  if (!group) return { ok: false, ledger, error: 'Group not found' };
  const currency = input.currency ?? group.currency;
  if (!isCurrency(currency)) return { ok: false, ledger, error: 'Unknown currency' };
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    return { ok: false, ledger, error: 'Enter an amount' };
  }

  const member = new Set(group.people.map((person) => person.id));
  let split = copySplit(input.split);
  let receipt: ReceiptSplit | undefined;
  if (input.receipt) {
    const everyoneIds = input.receipt.everyoneIds?.length
      ? [...input.receipt.everyoneIds]
      : split.lines.map((line) => line.personId);
    const peopleIds = everyoneIds.length > 0 ? everyoneIds : group.people.map((person) => person.id);
    const preview = previewItems({
      items: input.receipt.items,
      peopleIds,
      tax: input.receipt.tax,
      tip: input.receipt.tip,
    });
    if (!preview.ok) return { ok: false, ledger, error: preview.message };
    if (preview.grandCents !== input.amountCents) {
      return {
        ok: false,
        ledger,
        error: `Receipt is ${formatCents(preview.grandCents, currency)} but the expense is ${formatCents(input.amountCents, currency)}`,
      };
    }
    split = {
      method: 'exact',
      lines: preview.shares.map((share) => ({ personId: share.personId, value: share.cents })),
    };
    receipt = {
      items: input.receipt.items.map((item) => ({
        id: item.id,
        name: clip(item.name, 80, 'Item'),
        cents: item.cents,
        personIds: [...item.personIds],
      })),
      tax: input.receipt.tax ?? { kind: 'amount', value: 0 },
      tip: input.receipt.tip ?? { kind: 'amount', value: 0 },
      everyoneIds: [...peopleIds],
    };
  } else {
    const preview = previewSplit({
      amountCents: input.amountCents,
      method: split.method,
      lines: split.lines,
      currency,
    });
    if (!preview.ok) return { ok: false, ledger, error: preview.message };
  }

  const payers = previewPayers(input.amountCents, input.payers, currency);
  if (!payers.ok) return { ok: false, ledger, error: payers.message };
  const mentioned = [...split.lines.map((line) => line.personId), ...input.payers.map((payer) => payer.personId)];
  if (mentioned.some((id) => !member.has(id))) {
    return { ok: false, ledger, error: 'Unknown person' };
  }

  const expense: Expense = {
    id: input.id,
    groupId: group.id,
    description: clip(input.description ?? '', 80, 'Expense'),
    amountCents: input.amountCents,
    currency,
    payers: input.payers.map((payer) => ({ personId: payer.personId, cents: payer.cents })),
    split,
    ...(receipt ? { receipt } : {}),
    createdAt: stamp(input.createdAt),
  };
  return { ok: true, ledger: { ...ledger, expenses: [...ledger.expenses, expense] } };
}

export function addSettlement(
  ledger: SplitLedger,
  input: {
    id: string;
    groupId: string;
    fromId: string;
    toId: string;
    cents: number;
    currency?: CurrencyCode;
    createdAt?: number;
  },
): LedgerResult {
  if (!input.id) return { ok: false, ledger, error: 'Missing id' };
  if (ledger.settlements.some((entry) => entry.id === input.id)) {
    return { ok: false, ledger, error: 'Settlement already exists' };
  }
  const group = ledger.groups.find((entry) => entry.id === input.groupId);
  if (!group) return { ok: false, ledger, error: 'Group not found' };
  if (input.fromId === input.toId) return { ok: false, ledger, error: 'Pick two people' };
  const member = new Set(group.people.map((person) => person.id));
  if (!member.has(input.fromId) || !member.has(input.toId)) {
    return { ok: false, ledger, error: 'Unknown person' };
  }
  if (!Number.isInteger(input.cents) || input.cents <= 0) {
    return { ok: false, ledger, error: 'Enter an amount' };
  }
  const currency = input.currency ?? group.currency;
  if (!isCurrency(currency)) return { ok: false, ledger, error: 'Unknown currency' };
  const settlement: Settlement = {
    id: input.id,
    groupId: group.id,
    fromId: input.fromId,
    toId: input.toId,
    cents: input.cents,
    currency,
    createdAt: stamp(input.createdAt),
  };
  return { ok: true, ledger: { ...ledger, settlements: [...ledger.settlements, settlement] } };
}

export function expensesInGroup(ledger: SplitLedger, groupId: string): Expense[] {
  return ledger.expenses
    .filter((expense) => expense.groupId === groupId)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Per person, per currency. Positive netCents means the group owes them. */
export function balances(ledger: SplitLedger, groupId: string): PersonBalance[] {
  const group = ledger.groups.find((entry) => entry.id === groupId);
  if (!group) return [];
  const nets = new Map<string, number>();
  const currencies = new Set<CurrencyCode>([group.currency]);
  const add = (personId: string, currency: CurrencyCode, cents: number) => {
    const key = `${personId}\0${currency}`;
    nets.set(key, (nets.get(key) ?? 0) + cents);
    currencies.add(currency);
  };
  for (const expense of ledger.expenses) {
    if (expense.groupId !== groupId) continue;
    const shares = sharesOf(expense);
    for (const payer of expense.payers) add(payer.personId, expense.currency, payer.cents);
    for (const share of shares) add(share.personId, expense.currency, -share.cents);
  }
  for (const settlement of ledger.settlements) {
    if (settlement.groupId !== groupId) continue;
    add(settlement.fromId, settlement.currency, settlement.cents);
    add(settlement.toId, settlement.currency, -settlement.cents);
  }
  const ordered = [...currencies].sort((a, b) => {
    if (a === group.currency) return -1;
    if (b === group.currency) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const rows: PersonBalance[] = [];
  for (const currency of ordered) {
    for (const person of group.people) {
      rows.push({
        personId: person.id,
        name: person.name,
        isYou: person.isYou === true,
        currency,
        netCents: nets.get(`${person.id}\0${currency}`) ?? 0,
      });
    }
  }
  return rows;
}

/**
 * Greedy largest-debtor / largest-creditor, per currency. Ties break by id.
 * At most one transfer short of the number of non-zero balances in that currency.
 */
export function simplifyDebts(rows: Pick<PersonBalance, 'personId' | 'currency' | 'netCents'>[]): DebtTransfer[] {
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const transfers: DebtTransfer[] = [];
  for (const currency of currencies) {
    const nets = new Map<string, number>();
    for (const row of rows) {
      if (row.currency !== currency) continue;
      nets.set(row.personId, (nets.get(row.personId) ?? 0) + row.netCents);
    }
    const guard = Math.max(nets.size, 1);
    for (let step = 0; step < guard; step += 1) {
      const debtors = [...nets.entries()]
        .filter(([, net]) => net < 0)
        .sort((a, b) => a[1] - b[1] || cmp(a[0], b[0]));
      const creditors = [...nets.entries()]
        .filter(([, net]) => net > 0)
        .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
      const debtor = debtors[0];
      const creditor = creditors[0];
      if (!debtor || !creditor) break;
      const cents = Math.min(-debtor[1], creditor[1]);
      if (cents <= 0) break;
      transfers.push({ fromId: debtor[0], toId: creditor[0], cents, currency });
      nets.set(debtor[0], debtor[1] + cents);
      nets.set(creditor[0], creditor[1] - cents);
    }
  }
  return transfers;
}

export function whoOwesWhom(
  ledger: SplitLedger,
  groupId: string,
): { title: string; lines: OweLine[]; text: string } {
  const group = ledger.groups.find((entry) => entry.id === groupId);
  if (!group) return { title: '', lines: [], text: '' };
  const label = (id: string) => {
    const person = group.people.find((entry) => entry.id === id);
    if (!person) return 'Someone';
    return person.isYou ? 'You' : person.name;
  };
  const lines: OweLine[] = simplifyDebts(balances(ledger, groupId)).map((transfer) => {
    const from = label(transfer.fromId);
    const to = label(transfer.toId);
    const verb = from === 'You' ? 'owe' : 'owes';
    return {
      fromId: transfer.fromId,
      toId: transfer.toId,
      cents: transfer.cents,
      currency: transfer.currency,
      text: `${from} ${verb} ${to} ${formatCents(transfer.cents, transfer.currency)}`,
    };
  });
  const body = lines.length > 0 ? lines.map((line) => line.text) : ['Everyone is settled up.'];
  return {
    title: group.name,
    lines,
    text: [group.name, 'Who owes whom', ...body].join('\n'),
  };
}

function chargeCents(subtotal: number, charge: Charge | undefined): { ok: boolean; cents: number; message: string } {
  if (!charge) return { ok: true, cents: 0, message: '' };
  if (charge.kind !== 'percent' && charge.kind !== 'amount') {
    return { ok: false, cents: 0, message: 'Choose % or amount' };
  }
  if (!Number.isInteger(charge.value) || charge.value < 0) {
    return { ok: false, cents: 0, message: "Tax and tip can't be negative" };
  }
  if (charge.kind === 'amount') return { ok: true, cents: charge.value, message: '' };
  return { ok: true, cents: Math.round((subtotal * charge.value) / 10_000), message: '' };
}

function sharesOf(expense: Expense): ShareAmount[] {
  if (expense.receipt) {
    const preview = previewItems({
      items: expense.receipt.items,
      peopleIds: expense.receipt.everyoneIds,
      tax: expense.receipt.tax,
      tip: expense.receipt.tip,
    });
    if (preview.ok) return preview.shares;
  }
  const preview = previewSplit({
    amountCents: expense.amountCents,
    method: expense.split.method,
    lines: expense.split.lines,
    currency: expense.currency,
  });
  return preview.ok ? preview.shares : [];
}

/** Largest remainder. Remainder ties go to the earlier weight. */
function prorate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return deal(total, weights.length);
  const floors = weights.map((weight) => Math.floor((total * weight) / sum));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = weights
    .map((weight, index) => ({ index, rem: (total * weight) % sum }))
    .sort((a, b) => b.rem - a.rem || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

function deal(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, index) => (index < extra ? base + 1 : base));
}

function dealEqual(total: number, ids: string[]): ShareAmount[] {
  return zip(ids, deal(total, ids.length));
}

function prorateIds(total: number, weights: number[], ids: string[]): ShareAmount[] {
  return zip(ids, prorate(total, weights));
}

function zip(ids: string[], cents: number[]): ShareAmount[] {
  return ids.map((personId, index) => ({ personId, cents: cents[index] ?? 0 }));
}

function idsOf(lines: SplitLine[]): string[] {
  return lines.map((line) => line.personId);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function scaleRound(amount: number, bps: number): number {
  const mag = Math.round((amount * Math.abs(bps)) / 10_000);
  return bps < 0 ? -mag : mag;
}

function formatBps(bps: number): string {
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${whole}.${frac}%`;
}

function clip(value: string, max: number, fallback: string): string {
  const name = value.replace(/\s+/g, ' ').trim();
  return (name || fallback).slice(0, max);
}

function stamp(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) ? value : 0;
}

function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

function isMethod(value: string): value is SplitMethod {
  return value === 'equal' || value === 'exact' || value === 'percent' || value === 'shares' || value === 'adjustment';
}

function copySplit(split: { method: SplitMethod; lines: SplitLine[] }): { method: SplitMethod; lines: SplitLine[] } {
  return {
    method: split.method,
    lines: split.lines.map((line) => ({ personId: line.personId, value: line.value })),
  };
}

function replaceGroup(ledger: SplitLedger, group: SplitGroup): SplitLedger {
  return { ...ledger, groups: ledger.groups.map((entry) => (entry.id === group.id ? group : entry)) };
}
