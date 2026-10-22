// Offline Splitwise-style groups. Pure and import-free so the Node test
// runner can load this file alone. The Groups tab on the split screen
// uses this ledger. A group file (.etsplit) is merged by the import
// screen: last writer wins by updatedAt, and deviceId breaks ties.
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
  /** Set once a phone publishes or edits this person. Missing means unpublished. */
  updatedAt?: number;
  deviceId?: string;
}

export interface SplitGroup {
  id: string;
  name: string;
  currency: CurrencyCode;
  people: Person[];
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
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
  updatedAt?: number;
  deviceId?: string;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  cents: number;
  currency: CurrencyCode;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
}

export interface SplitLedger {
  groups: SplitGroup[];
  expenses: Expense[];
  settlements: Settlement[];
  /** Deletes that have to win on the next import. Absent means none. */
  tombstones?: Tombstone[];
  /** This phone. Tie-break id stamped on edits made here. */
  deviceId?: string;
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
  input: {
    id: string;
    name: string;
    youId: string;
    currency?: CurrencyCode;
    createdAt?: number;
    updatedAt?: number;
    deviceId?: string;
  },
): LedgerResult {
  if (!input.id || !input.youId) return { ok: false, ledger, error: 'Missing id' };
  if (ledger.groups.some((group) => group.id === input.id)) {
    return { ok: false, ledger, error: 'Group already exists' };
  }
  const currency = input.currency ?? 'USD';
  if (!isCurrency(currency)) return { ok: false, ledger, error: 'Unknown currency' };
  const you: Person = { id: input.youId, name: 'You', isYou: true };
  const group: SplitGroup = {
    id: input.id,
    name: clip(input.name, 40, 'Group'),
    currency,
    people: [you],
    createdAt: stamp(input.createdAt),
  };
  if (input.updatedAt !== undefined) {
    group.updatedAt = input.updatedAt;
    you.updatedAt = input.updatedAt;
  }
  if (input.deviceId) {
    group.deviceId = input.deviceId;
    you.deviceId = input.deviceId;
  }
  return { ok: true, ledger: { ...ledger, groups: [...ledger.groups, group] } };
}

export function addPerson(
  ledger: SplitLedger,
  groupId: string,
  person: { id: string; name: string; updatedAt?: number; deviceId?: string },
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
  if (person.updatedAt !== undefined) next.updatedAt = person.updatedAt;
  if (person.deviceId) next.deviceId = person.deviceId;
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
    updatedAt?: number;
    deviceId?: string;
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
  if (input.updatedAt !== undefined) expense.updatedAt = input.updatedAt;
  if (input.deviceId) expense.deviceId = input.deviceId;
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
    updatedAt?: number;
    deviceId?: string;
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
  if (input.updatedAt !== undefined) settlement.updatedAt = input.updatedAt;
  if (input.deviceId) settlement.deviceId = input.deviceId;
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

// --- Group file (.etsplit). One group per file. Schema 1. ---

/** Version written into every group file and the on-phone ledger copy. */
export const SPLIT_FILE_SCHEMA = 1;
/** Filename extension. Declared as its own UTI so AirDrop, Messages, WhatsApp, and Files open Everytool. */
export const SPLIT_FILE_EXTENSION = 'etsplit';
export const SPLIT_FILE_UTI = 'app.everytool.ios.etsplit';
export const SPLIT_FILE_KIND = 'app.everytool.ios.etsplit';
export const SPLIT_FILE_MIME = 'application/vnd.everytool.etsplit+json';
/** AsyncStorage key. Not the clipboard AppState document. */
export const SPLIT_LEDGER_STORAGE_KEY = 'everytool.split-ledger.v1';

export type TombstoneKind = 'group' | 'person' | 'expense' | 'settlement';

export interface Tombstone {
  id: string;
  groupId: string;
  kind: TombstoneKind;
  updatedAt: number;
  deviceId: string;
}

export interface SyncStamp {
  updatedAt: number;
  deviceId: string;
}

export interface SplitFilePerson {
  id: string;
  name: string;
  isYou: boolean;
  updatedAt: number;
  deviceId: string;
}

export interface SplitFileGroup {
  id: string;
  name: string;
  currency: CurrencyCode;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  people: SplitFilePerson[];
}

export interface SplitFileExpense {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: CurrencyCode;
  payers: Payer[];
  split: { method: SplitMethod; lines: SplitLine[] };
  receipt?: ReceiptSplit;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}

export interface SplitFileSettlement {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  cents: number;
  currency: CurrencyCode;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}

export interface SplitGroupFile {
  schema: typeof SPLIT_FILE_SCHEMA;
  kind: typeof SPLIT_FILE_KIND;
  extension: typeof SPLIT_FILE_EXTENSION;
  deviceId: string;
  exportedAt: number;
  groupId: string;
  /** Null when this file is a delete of the whole group. */
  group: SplitFileGroup | null;
  expenses: SplitFileExpense[];
  settlements: SplitFileSettlement[];
  tombstones: Tombstone[];
}

export interface ImportChange {
  kind: TombstoneKind;
  id: string;
  change: 'new' | 'updated' | 'removed';
  label: string;
}

export interface ImportPreview {
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
  /** Exactly `3 new, 1 updated, 0 removed`. */
  summary: string;
  changes: ImportChange[];
  error?: string;
}

export interface SummaryTotal {
  name: string;
  text: string;
  tone: 'owed' | 'owes' | 'settled';
  netCents: number;
  currency: CurrencyCode;
}

export interface SummaryShare {
  title: string;
  oweLines: string[];
  totals: SummaryTotal[];
  /** Plain text for the share sheet: who owes whom, then per-person totals. */
  text: string;
}

interface Live<T> {
  value: T;
  stamp: SyncStamp;
  content: string;
  label: string;
}

/** Greater updatedAt wins. The same time yields to the greater deviceId. A tie keeps the copy already on the phone. */
function newer(a: SyncStamp, b: SyncStamp): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.deviceId > b.deviceId;
}

function localStamp(record: { updatedAt?: number; deviceId?: string; createdAt?: number }): SyncStamp {
  return {
    updatedAt: record.updatedAt ?? record.createdAt ?? 0,
    deviceId: record.deviceId ?? '',
  };
}

function publishStamp(
  record: { updatedAt?: number; deviceId?: string; createdAt?: number },
  fallback: SyncStamp,
): SyncStamp {
  const hasStamp = record.updatedAt !== undefined || (record.deviceId !== undefined && record.deviceId.length > 0);
  if (!hasStamp) return { updatedAt: fallback.updatedAt, deviceId: fallback.deviceId };
  return {
    updatedAt: record.updatedAt ?? record.createdAt ?? 0,
    deviceId: record.deviceId && record.deviceId.length > 0 ? record.deviceId : fallback.deviceId,
  };
}

function countSummary(added: number, updated: number, removed: number): string {
  return `${added} new, ${updated} updated, ${removed} removed`;
}

export function fileNameForGroup(name: string): string {
  const stem = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${stem || 'Group'}.${SPLIT_FILE_EXTENSION}`;
}

export function assignDeviceId(ledger: SplitLedger, deviceId: string): SplitLedger {
  if (ledger.deviceId || !deviceId) return ledger;
  return { ...ledger, deviceId };
}

function personContent(person: { name: string; isYou?: boolean }): string {
  return JSON.stringify({ name: person.name, isYou: person.isYou === true });
}

function groupContent(group: { name: string; currency: CurrencyCode }): string {
  return JSON.stringify({ name: group.name, currency: group.currency });
}

function expenseContent(expense: {
  description: string;
  amountCents: number;
  currency: CurrencyCode;
  payers: Payer[];
  split: { method: SplitMethod; lines: SplitLine[] };
  receipt?: ReceiptSplit;
}): string {
  return JSON.stringify({
    description: expense.description,
    amountCents: expense.amountCents,
    currency: expense.currency,
    payers: expense.payers.map((payer) => ({ personId: payer.personId, cents: payer.cents })),
    split: {
      method: expense.split.method,
      lines: expense.split.lines.map((line) => ({ personId: line.personId, value: line.value })),
    },
    receipt: expense.receipt
      ? {
          items: expense.receipt.items.map((item) => ({
            id: item.id,
            name: item.name,
            cents: item.cents,
            personIds: [...item.personIds],
          })),
          tax: { kind: expense.receipt.tax.kind, value: expense.receipt.tax.value },
          tip: { kind: expense.receipt.tip.kind, value: expense.receipt.tip.value },
          everyoneIds: [...expense.receipt.everyoneIds],
        }
      : null,
  });
}

function settlementContent(settlement: {
  fromId: string;
  toId: string;
  cents: number;
  currency: CurrencyCode;
}): string {
  return JSON.stringify({
    fromId: settlement.fromId,
    toId: settlement.toId,
    cents: settlement.cents,
    currency: settlement.currency,
  });
}

function copyPerson(person: Person): Person {
  const next: Person = { id: person.id, name: person.name };
  if (person.isYou) next.isYou = true;
  if (person.updatedAt !== undefined) next.updatedAt = person.updatedAt;
  if (person.deviceId) next.deviceId = person.deviceId;
  return next;
}

function copyExpense(expense: Expense): Expense {
  const next: Expense = {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    amountCents: expense.amountCents,
    currency: expense.currency,
    payers: expense.payers.map((payer) => ({ personId: payer.personId, cents: payer.cents })),
    split: {
      method: expense.split.method,
      lines: expense.split.lines.map((line) => ({ personId: line.personId, value: line.value })),
    },
    createdAt: expense.createdAt,
  };
  if (expense.updatedAt !== undefined) next.updatedAt = expense.updatedAt;
  if (expense.deviceId) next.deviceId = expense.deviceId;
  if (expense.receipt) next.receipt = copyReceipt(expense.receipt);
  return next;
}

function copySettlement(settlement: Settlement): Settlement {
  const next: Settlement = {
    id: settlement.id,
    groupId: settlement.groupId,
    fromId: settlement.fromId,
    toId: settlement.toId,
    cents: settlement.cents,
    currency: settlement.currency,
    createdAt: settlement.createdAt,
  };
  if (settlement.updatedAt !== undefined) next.updatedAt = settlement.updatedAt;
  if (settlement.deviceId) next.deviceId = settlement.deviceId;
  return next;
}

function copyReceipt(receipt: ReceiptSplit): ReceiptSplit {
  return {
    items: receipt.items.map((item) => ({
      id: item.id,
      name: item.name,
      cents: item.cents,
      personIds: [...item.personIds],
    })),
    tax: { kind: receipt.tax.kind, value: receipt.tax.value },
    tip: { kind: receipt.tip.kind, value: receipt.tip.value },
    everyoneIds: [...receipt.everyoneIds],
  };
}

function personFromFile(person: SplitFilePerson): Person {
  const next: Person = {
    id: person.id,
    name: person.name,
    updatedAt: person.updatedAt,
    deviceId: person.deviceId,
  };
  if (person.isYou) next.isYou = true;
  return next;
}

function expenseFromFile(expense: SplitFileExpense): Expense {
  const next: Expense = {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    amountCents: expense.amountCents,
    currency: expense.currency,
    payers: expense.payers.map((payer) => ({ personId: payer.personId, cents: payer.cents })),
    split: {
      method: expense.split.method,
      lines: expense.split.lines.map((line) => ({ personId: line.personId, value: line.value })),
    },
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    deviceId: expense.deviceId,
  };
  if (expense.receipt) next.receipt = copyReceipt(expense.receipt);
  return next;
}

function settlementFromFile(settlement: SplitFileSettlement): Settlement {
  return {
    id: settlement.id,
    groupId: settlement.groupId,
    fromId: settlement.fromId,
    toId: settlement.toId,
    cents: settlement.cents,
    currency: settlement.currency,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    deviceId: settlement.deviceId,
  };
}

function upsertTomb(list: Tombstone[], tomb: Tombstone): Tombstone[] {
  const index = list.findIndex(
    (entry) => entry.kind === tomb.kind && entry.id === tomb.id && entry.groupId === tomb.groupId,
  );
  if (index < 0) return [...list, tomb];
  const prev = list[index]!;
  if (newer({ updatedAt: prev.updatedAt, deviceId: prev.deviceId }, tomb)) return list;
  const next = list.slice();
  next[index] = tomb;
  return next;
}

export function deletePerson(
  ledger: SplitLedger,
  groupId: string,
  personId: string,
  stamp: SyncStamp,
): LedgerResult {
  if (!Number.isInteger(stamp.updatedAt) || !stamp.deviceId) {
    return { ok: false, ledger, error: 'Missing stamp' };
  }
  const group = ledger.groups.find((entry) => entry.id === groupId);
  if (!group) return { ok: false, ledger, error: 'Group not found' };
  if (!group.people.some((person) => person.id === personId)) {
    return { ok: false, ledger, error: 'Person not found' };
  }
  const tomb: Tombstone = {
    id: personId,
    groupId,
    kind: 'person',
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
  };
  return {
    ok: true,
    ledger: {
      ...ledger,
      tombstones: upsertTomb(ledger.tombstones ?? [], tomb),
      groups: ledger.groups.map((entry) =>
        entry.id === groupId
          ? { ...entry, people: entry.people.filter((person) => person.id !== personId) }
          : entry,
      ),
    },
  };
}

export function deleteExpense(ledger: SplitLedger, expenseId: string, stamp: SyncStamp): LedgerResult {
  if (!Number.isInteger(stamp.updatedAt) || !stamp.deviceId) {
    return { ok: false, ledger, error: 'Missing stamp' };
  }
  const expense = ledger.expenses.find((entry) => entry.id === expenseId);
  if (!expense) return { ok: false, ledger, error: 'Expense not found' };
  const tomb: Tombstone = {
    id: expense.id,
    groupId: expense.groupId,
    kind: 'expense',
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
  };
  return {
    ok: true,
    ledger: {
      ...ledger,
      expenses: ledger.expenses.filter((entry) => entry.id !== expenseId),
      tombstones: upsertTomb(ledger.tombstones ?? [], tomb),
    },
  };
}

export function deleteSettlement(ledger: SplitLedger, settlementId: string, stamp: SyncStamp): LedgerResult {
  if (!Number.isInteger(stamp.updatedAt) || !stamp.deviceId) {
    return { ok: false, ledger, error: 'Missing stamp' };
  }
  const settlement = ledger.settlements.find((entry) => entry.id === settlementId);
  if (!settlement) return { ok: false, ledger, error: 'Settlement not found' };
  const tomb: Tombstone = {
    id: settlement.id,
    groupId: settlement.groupId,
    kind: 'settlement',
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
  };
  return {
    ok: true,
    ledger: {
      ...ledger,
      settlements: ledger.settlements.filter((entry) => entry.id !== settlementId),
      tombstones: upsertTomb(ledger.tombstones ?? [], tomb),
    },
  };
}

export function deleteGroup(ledger: SplitLedger, groupId: string, stamp: SyncStamp): LedgerResult {
  if (!Number.isInteger(stamp.updatedAt) || !stamp.deviceId) {
    return { ok: false, ledger, error: 'Missing stamp' };
  }
  const group = ledger.groups.find((entry) => entry.id === groupId);
  if (!group) return { ok: false, ledger, error: 'Group not found' };
  let tombstones = ledger.tombstones ?? [];
  const mark = (id: string, kind: TombstoneKind) => {
    tombstones = upsertTomb(tombstones, {
      id,
      groupId,
      kind,
      updatedAt: stamp.updatedAt,
      deviceId: stamp.deviceId,
    });
  };
  mark(groupId, 'group');
  for (const person of group.people) mark(person.id, 'person');
  for (const expense of ledger.expenses) if (expense.groupId === groupId) mark(expense.id, 'expense');
  for (const settlement of ledger.settlements) {
    if (settlement.groupId === groupId) mark(settlement.id, 'settlement');
  }
  return {
    ok: true,
    ledger: {
      ...ledger,
      groups: ledger.groups.filter((entry) => entry.id !== groupId),
      expenses: ledger.expenses.filter((entry) => entry.groupId !== groupId),
      settlements: ledger.settlements.filter((entry) => entry.groupId !== groupId),
      tombstones,
    },
  };
}

function tombKey(kind: TombstoneKind, id: string): string {
  return `${kind}\0${id}`;
}

function indexTombs(list: readonly Tombstone[], groupId: string): Map<string, Tombstone> {
  const map = new Map<string, Tombstone>();
  for (const tomb of list) {
    if (tomb.groupId !== groupId) continue;
    const key = tombKey(tomb.kind, tomb.id);
    const prev = map.get(key);
    if (!prev || newer(tomb, prev)) map.set(key, tomb);
  }
  return map;
}

function chooseLive<T>(local: Live<T> | null, incoming: Live<T> | null): { source: 'local' | 'incoming'; live: Live<T> } | null {
  if (!incoming) return local ? { source: 'local', live: local } : null;
  if (!local || newer(incoming.stamp, local.stamp)) return { source: 'incoming', live: incoming };
  return { source: 'local', live: local };
}

function orderPeople(next: Person[], previous: Person[]): Person[] {
  const byId = new Map(next.map((person) => [person.id, person]));
  const ordered: Person[] = [];
  for (const person of previous) {
    const found = byId.get(person.id);
    if (!found) continue;
    ordered.push(found);
    byId.delete(person.id);
  }
  const rest = [...byId.values()].sort((a, b) => {
    if (a.isYou === b.isYou) return cmp(a.id, b.id);
    return a.isYou ? -1 : 1;
  });
  return [...ordered, ...rest];
}

function filePersonLive(person: SplitFilePerson): Live<Person> {
  return {
    value: personFromFile(person),
    stamp: { updatedAt: person.updatedAt, deviceId: person.deviceId },
    content: personContent(person),
    label: person.name,
  };
}

function localPersonLive(person: Person): Live<Person> {
  return {
    value: copyPerson(person),
    stamp: localStamp(person),
    content: personContent(person),
    label: person.name,
  };
}

interface MergeResult {
  ledger: SplitLedger;
  preview: ImportPreview;
}

export function mergeGroupFile(ledger: SplitLedger, file: SplitGroupFile): MergeResult {
  const groupId = file.groupId;
  const localGroup = ledger.groups.find((group) => group.id === groupId) ?? null;
  const tombs = indexTombs([...(ledger.tombstones ?? []), ...file.tombstones], groupId);
  const groupTomb = tombs.get(tombKey('group', groupId)) ?? null;
  const incomingGroup = file.group;
  const localGroupLive: Live<SplitGroup> | null = localGroup
    ? {
        value: localGroup,
        stamp: localStamp(localGroup),
        content: groupContent(localGroup),
        label: localGroup.name,
      }
    : null;
  const incomingGroupLive: Live<SplitFileGroup> | null = incomingGroup
    ? {
        value: incomingGroup,
        stamp: { updatedAt: incomingGroup.updatedAt, deviceId: incomingGroup.deviceId },
        content: groupContent(incomingGroup),
        label: incomingGroup.name,
      }
    : null;
  const chosenGroup = chooseLive(localGroupLive, incomingGroupLive);
  const groupDeleted = Boolean(chosenGroup && groupTomb && newer(groupTomb, chosenGroup.live.stamp)) || (!chosenGroup && Boolean(groupTomb));
  const changes: ImportChange[] = [];

  const dropGroup = (): MergeResult => {
    if (localGroup) {
      changes.push({ kind: 'group', id: groupId, change: 'removed', label: localGroup.name });
      for (const person of localGroup.people) {
        changes.push({ kind: 'person', id: person.id, change: 'removed', label: person.name });
      }
      for (const expense of ledger.expenses) {
        if (expense.groupId === groupId) {
          changes.push({ kind: 'expense', id: expense.id, change: 'removed', label: expense.description });
        }
      }
      for (const settlement of ledger.settlements) {
        if (settlement.groupId === groupId) {
          changes.push({ kind: 'settlement', id: settlement.id, change: 'removed', label: 'Settlement' });
        }
      }
    }
    const others = (ledger.tombstones ?? []).filter((tomb) => tomb.groupId !== groupId);
    return {
      ledger: {
        ...ledger,
        groups: ledger.groups.filter((group) => group.id !== groupId),
        expenses: ledger.expenses.filter((expense) => expense.groupId !== groupId),
        settlements: ledger.settlements.filter((settlement) => settlement.groupId !== groupId),
        tombstones: [...others, ...tombs.values()],
      },
      preview: finishPreview(changes),
    };
  };

  if (groupDeleted || !chosenGroup) return dropGroup();

  const peopleChanges: ImportChange[] = [];
  const localPeople = localGroup?.people ?? [];
  const filePeople = incomingGroup?.people ?? [];
  const peopleIds = [...new Set([...localPeople.map((person) => person.id), ...filePeople.map((person) => person.id)])].sort(
    cmp,
  );
  const mergedPeople: Person[] = [];
  for (const id of peopleIds) {
    const local = localPeople.find((person) => person.id === id) ?? null;
    const incoming = filePeople.find((person) => person.id === id) ?? null;
    const chosen = chooseLive(local ? localPersonLive(local) : null, incoming ? filePersonLive(incoming) : null);
    const tomb = tombs.get(tombKey('person', id)) ?? null;
    if (!chosen || (tomb && newer(tomb, chosen.live.stamp))) {
      if (local) peopleChanges.push({ kind: 'person', id, change: 'removed', label: local.name });
      continue;
    }
    if (!local) peopleChanges.push({ kind: 'person', id, change: 'new', label: chosen.live.label });
    else if (chosen.source === 'incoming' && chosen.live.content !== personContent(local)) {
      peopleChanges.push({ kind: 'person', id, change: 'updated', label: chosen.live.label });
    }
    const person = chosen.live.value;
    person.updatedAt = chosen.live.stamp.updatedAt;
    person.deviceId = chosen.live.stamp.deviceId;
    mergedPeople.push(person);
  }

  const expenseChanges: ImportChange[] = [];
  const mergedExpenses = mergeRecords(
    ledger.expenses.filter((expense) => expense.groupId === groupId),
    file.expenses,
    tombs,
    'expense',
    (expense) => expense.id,
    (expense) => ({
      value: copyExpense(expense),
      stamp: localStamp(expense),
      content: expenseContent(expense),
      label: expense.description,
    }),
    (expense) => ({
      value: expenseFromFile(expense),
      stamp: { updatedAt: expense.updatedAt, deviceId: expense.deviceId },
      content: expenseContent(expense),
      label: expense.description,
    }),
    (chosen) => {
      const expense = chosen.value;
      expense.updatedAt = chosen.stamp.updatedAt;
      expense.deviceId = chosen.stamp.deviceId;
      return expense;
    },
    expenseChanges,
  );

  const settlementChanges: ImportChange[] = [];
  const mergedSettlements = mergeRecords(
    ledger.settlements.filter((settlement) => settlement.groupId === groupId),
    file.settlements,
    tombs,
    'settlement',
    (settlement) => settlement.id,
    (settlement) => ({
      value: copySettlement(settlement),
      stamp: localStamp(settlement),
      content: settlementContent(settlement),
      label: 'Settlement',
    }),
    (settlement) => ({
      value: settlementFromFile(settlement),
      stamp: { updatedAt: settlement.updatedAt, deviceId: settlement.deviceId },
      content: settlementContent(settlement),
      label: 'Settlement',
    }),
    (chosen) => {
      const settlement = chosen.value;
      settlement.updatedAt = chosen.stamp.updatedAt;
      settlement.deviceId = chosen.stamp.deviceId;
      return settlement;
    },
    settlementChanges,
  );

  const groupStamp = chosenGroup.live.stamp;
  const groupSource = chosenGroup.source === 'incoming' && incomingGroup ? incomingGroup : null;
  const base = groupSource
    ? {
        id: groupId,
        name: groupSource.name,
        currency: groupSource.currency,
        createdAt: groupSource.createdAt,
        updatedAt: groupStamp.updatedAt,
        deviceId: groupStamp.deviceId,
      }
    : {
        id: localGroup!.id,
        name: localGroup!.name,
        currency: localGroup!.currency,
        createdAt: localGroup!.createdAt,
        updatedAt: groupStamp.updatedAt,
        deviceId: groupStamp.deviceId,
      };
  if (!localGroup) changes.push({ kind: 'group', id: groupId, change: 'new', label: base.name });
  else if (chosenGroup.source === 'incoming' && chosenGroup.live.content !== groupContent(localGroup)) {
    changes.push({ kind: 'group', id: groupId, change: 'updated', label: base.name });
  }
  changes.push(...peopleChanges, ...expenseChanges, ...settlementChanges);

  const survivors: { kind: TombstoneKind; id: string; stamp: SyncStamp }[] = [
    { kind: 'group', id: groupId, stamp: groupStamp },
    ...mergedPeople.map((person) => ({
      kind: 'person' as const,
      id: person.id,
      stamp: { updatedAt: person.updatedAt ?? 0, deviceId: person.deviceId ?? '' },
    })),
    ...mergedExpenses.map((expense) => ({
      kind: 'expense' as const,
      id: expense.id,
      stamp: { updatedAt: expense.updatedAt ?? 0, deviceId: expense.deviceId ?? '' },
    })),
    ...mergedSettlements.map((settlement) => ({
      kind: 'settlement' as const,
      id: settlement.id,
      stamp: { updatedAt: settlement.updatedAt ?? 0, deviceId: settlement.deviceId ?? '' },
    })),
  ];
  const keptTombs: Tombstone[] = [];
  for (const tomb of tombs.values()) {
    const live = survivors.find((entry) => entry.kind === tomb.kind && entry.id === tomb.id);
    if (live && !newer(tomb, live.stamp)) continue;
    keptTombs.push(tomb);
  }
  const nextGroup: SplitGroup = {
    ...base,
    people: orderPeople(mergedPeople, localPeople),
  };
  const groups = localGroup
    ? ledger.groups.map((group) => (group.id === groupId ? nextGroup : group))
    : [...ledger.groups, nextGroup];
  return {
    ledger: {
      ...ledger,
      groups,
      expenses: spliceByGroup(ledger.expenses, groupId, mergedExpenses),
      settlements: spliceByGroup(ledger.settlements, groupId, mergedSettlements),
      tombstones: [...(ledger.tombstones ?? []).filter((tomb) => tomb.groupId !== groupId), ...keptTombs],
    },
    preview: finishPreview(changes),
  };
}

function finishPreview(changes: ImportChange[]): ImportPreview {
  const added = changes.filter((change) => change.change === 'new').length;
  const updated = changes.filter((change) => change.change === 'updated').length;
  const removed = changes.filter((change) => change.change === 'removed').length;
  return { ok: true, added, updated, removed, summary: countSummary(added, updated, removed), changes };
}

function spliceByGroup<T extends { id: string; groupId: string }>(all: T[], groupId: string, merged: T[]): T[] {
  const byId = new Map(merged.map((entry) => [entry.id, entry]));
  const used = new Set<string>();
  const next: T[] = [];
  for (const entry of all) {
    if (entry.groupId !== groupId) {
      next.push(entry);
      continue;
    }
    const found = byId.get(entry.id);
    if (!found) continue;
    next.push(found);
    used.add(entry.id);
  }
  const added = merged.filter((entry) => !used.has(entry.id)).sort((a, b) => cmp(a.id, b.id));
  return [...next, ...added];
}

function mergeRecords<TLocal extends { id: string }, TFile extends { id: string }, TOut>(
  localRows: TLocal[],
  fileRows: TFile[],
  tombs: Map<string, Tombstone>,
  kind: TombstoneKind,
  idOfFile: (row: TFile) => string,
  localLive: (row: TLocal) => Live<TOut>,
  fileLive: (row: TFile) => Live<TOut>,
  adopt: (live: Live<TOut>) => TOut,
  changes: ImportChange[],
): TOut[] {
  const ids = [...new Set([...localRows.map((row) => row.id), ...fileRows.map((row) => idOfFile(row))])].sort(cmp);
  const out: TOut[] = [];
  for (const id of ids) {
    const local = localRows.find((row) => row.id === id) ?? null;
    const incoming = fileRows.find((row) => idOfFile(row) === id) ?? null;
    const chosen = chooseLive(local ? localLive(local) : null, incoming ? fileLive(incoming) : null);
    const tomb = tombs.get(tombKey(kind, id)) ?? null;
    if (!chosen || (tomb && newer(tomb, chosen.live.stamp))) {
      if (local) changes.push({ kind, id, change: 'removed', label: localLive(local).label });
      continue;
    }
    if (!local) changes.push({ kind, id, change: 'new', label: chosen.live.label });
    else if (chosen.source === 'incoming' && chosen.live.content !== localLive(local).content) {
      changes.push({ kind, id, change: 'updated', label: chosen.live.label });
    }
    out.push(adopt(chosen.live));
  }
  return out;
}

export function previewGroupImport(ledger: SplitLedger, file: SplitGroupFile): ImportPreview {
  return mergeGroupFile(ledger, file).preview;
}

export function applyGroupImport(
  ledger: SplitLedger,
  file: SplitGroupFile,
): { ok: true; ledger: SplitLedger; preview: ImportPreview } | { ok: false; ledger: SplitLedger; error: string } {
  const merged = mergeGroupFile(ledger, file);
  return { ok: true, ledger: merged.ledger, preview: merged.preview };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asStamp(record: Record<string, unknown>): SyncStamp | null {
  const updatedAt = asInt(record.updatedAt);
  const deviceId = asString(record.deviceId);
  if (updatedAt === null || !deviceId) return null;
  return { updatedAt, deviceId };
}

export function parseGroupFile(text: string): { ok: true; file: SplitGroupFile } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not an Everytool split group.' };
  }
  const root = asObject(raw);
  if (!root) return { ok: false, error: 'This file is not an Everytool split group.' };
  const schema = asInt(root.schema);
  if (schema !== null && schema > SPLIT_FILE_SCHEMA) {
    return { ok: false, error: 'This split file is from a newer Everytool. Update the app to open it.' };
  }
  if (schema !== SPLIT_FILE_SCHEMA || root.kind !== SPLIT_FILE_KIND) {
    return { ok: false, error: 'This file is not an Everytool split group.' };
  }
  const groupId = asString(root.groupId);
  const deviceId = asString(root.deviceId);
  const exportedAt = asInt(root.exportedAt);
  if (!groupId || !deviceId || exportedAt === null) {
    return { ok: false, error: 'This file is not an Everytool split group.' };
  }
  const group = parseFileGroup(root.group, groupId);
  if (!group.ok) return group;
  const expenses = parseFileExpenses(root.expenses, groupId);
  if (!expenses.ok) return expenses;
  const settlements = parseFileSettlements(root.settlements, groupId);
  if (!settlements.ok) return settlements;
  const tombstones = parseTombstones(root.tombstones, groupId);
  if (!tombstones.ok) return tombstones;
  if (!group.group && !tombstones.tombstones.some((tomb) => tomb.kind === 'group' && tomb.id === groupId)) {
    return { ok: false, error: 'This file is not an Everytool split group.' };
  }
  return {
    ok: true,
    file: {
      schema: SPLIT_FILE_SCHEMA,
      kind: SPLIT_FILE_KIND,
      extension: SPLIT_FILE_EXTENSION,
      deviceId,
      exportedAt,
      groupId,
      group: group.group,
      expenses: expenses.expenses,
      settlements: settlements.settlements,
      tombstones: tombstones.tombstones,
    },
  };
}

function parseFileGroup(
  value: unknown,
  groupId: string,
): { ok: true; group: SplitFileGroup | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, group: null };
  const record = asObject(value);
  if (!record || record.id !== groupId) return { ok: false, error: 'This file is not an Everytool split group.' };
  const name = typeof record.name === 'string' ? clip(record.name, 40, 'Group') : null;
  const currency = typeof record.currency === 'string' && isCurrency(record.currency) ? record.currency : null;
  const createdAt = asInt(record.createdAt);
  const stampValue = asStamp(record);
  if (!name || !currency || createdAt === null || !stampValue) {
    return { ok: false, error: 'This file is not an Everytool split group.' };
  }
  if (!Array.isArray(record.people)) return { ok: false, error: 'This file is not an Everytool split group.' };
  const people: SplitFilePerson[] = [];
  const seen = new Set<string>();
  for (const entry of record.people) {
    const person = asObject(entry);
    if (!person) return { ok: false, error: 'This file is not an Everytool split group.' };
    const id = asString(person.id);
    const personName = typeof person.name === 'string' ? clip(person.name, 40, 'Person') : null;
    const personStamp = asStamp(person);
    if (!id || !personName || !personStamp || seen.has(id)) {
      return { ok: false, error: 'This file is not an Everytool split group.' };
    }
    seen.add(id);
    people.push({
      id,
      name: personName,
      isYou: person.isYou === true,
      updatedAt: personStamp.updatedAt,
      deviceId: personStamp.deviceId,
    });
  }
  return {
    ok: true,
    group: {
      id: groupId,
      name,
      currency,
      createdAt,
      updatedAt: stampValue.updatedAt,
      deviceId: stampValue.deviceId,
      people,
    },
  };
}

function parseFileExpenses(
  value: unknown,
  groupId: string,
): { ok: true; expenses: SplitFileExpense[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'This file is not an Everytool split group.' };
  const expenses: SplitFileExpense[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = asObject(entry);
    if (!record) return { ok: false, error: 'This file is not an Everytool split group.' };
    const id = asString(record.id);
    const description = typeof record.description === 'string' ? clip(record.description, 80, 'Expense') : null;
    const amountCents = asInt(record.amountCents);
    const currency = typeof record.currency === 'string' && isCurrency(record.currency) ? record.currency : null;
    const createdAt = asInt(record.createdAt);
    const stampValue = asStamp(record);
    const split = asObject(record.split);
    if (
      !id ||
      !description ||
      amountCents === null ||
      amountCents < 0 ||
      !currency ||
      createdAt === null ||
      !stampValue ||
      record.groupId !== groupId ||
      seen.has(id) ||
      !split ||
      !isMethod(String(split.method)) ||
      !Array.isArray(split.lines)
    ) {
      return { ok: false, error: 'This file is not an Everytool split group.' };
    }
    const lines: SplitLine[] = [];
    for (const line of split.lines) {
      const row = asObject(line);
      const personId = row ? asString(row.personId) : null;
      const lineValue = row ? asInt(row.value) : null;
      if (!personId || lineValue === null) return { ok: false, error: 'This file is not an Everytool split group.' };
      lines.push({ personId, value: lineValue });
    }
    if (!Array.isArray(record.payers)) return { ok: false, error: 'This file is not an Everytool split group.' };
    const payers: Payer[] = [];
    for (const payer of record.payers) {
      const row = asObject(payer);
      const personId = row ? asString(row.personId) : null;
      const cents = row ? asInt(row.cents) : null;
      if (!personId || cents === null || cents < 0) {
        return { ok: false, error: 'This file is not an Everytool split group.' };
      }
      payers.push({ personId, cents });
    }
    let receipt: ReceiptSplit | undefined;
    if (record.receipt !== undefined && record.receipt !== null) {
      const parsed = parseReceiptSplit(record.receipt);
      if (!parsed) return { ok: false, error: 'This file is not an Everytool split group.' };
      receipt = parsed;
    }
    seen.add(id);
    const expense: SplitFileExpense = {
      id,
      groupId,
      description,
      amountCents,
      currency,
      payers,
      split: { method: split.method as SplitMethod, lines },
      createdAt,
      updatedAt: stampValue.updatedAt,
      deviceId: stampValue.deviceId,
    };
    if (receipt) expense.receipt = receipt;
    expenses.push(expense);
  }
  return { ok: true, expenses };
}

function parseReceiptSplit(value: unknown): ReceiptSplit | null {
  const record = asObject(value);
  if (!record || !Array.isArray(record.items) || !Array.isArray(record.everyoneIds)) return null;
  const tax = parseCharge(record.tax);
  const tip = parseCharge(record.tip);
  if (!tax || !tip) return null;
  const items: ReceiptItem[] = [];
  for (const entry of record.items) {
    const item = asObject(entry);
    if (!item) return null;
    const id = asString(item.id);
    const name = typeof item.name === 'string' ? clip(item.name, 80, 'Item') : null;
    const cents = asInt(item.cents);
    if (!id || !name || cents === null || cents < 0 || !Array.isArray(item.personIds)) return null;
    const personIds: string[] = [];
    for (const personId of item.personIds) {
      if (typeof personId !== 'string' || !personId) return null;
      personIds.push(personId);
    }
    items.push({ id, name, cents, personIds });
  }
  const everyoneIds: string[] = [];
  for (const personId of record.everyoneIds) {
    if (typeof personId !== 'string' || !personId) return null;
    everyoneIds.push(personId);
  }
  return { items, tax, tip, everyoneIds };
}

function parseCharge(value: unknown): Charge | null {
  const record = asObject(value);
  if (!record) return null;
  const amount = asInt(record.value);
  if (amount === null || amount < 0) return null;
  if (record.kind !== 'percent' && record.kind !== 'amount') return null;
  return { kind: record.kind, value: amount };
}

function parseFileSettlements(
  value: unknown,
  groupId: string,
): { ok: true; settlements: SplitFileSettlement[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'This file is not an Everytool split group.' };
  const settlements: SplitFileSettlement[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = asObject(entry);
    if (!record) return { ok: false, error: 'This file is not an Everytool split group.' };
    const id = asString(record.id);
    const fromId = asString(record.fromId);
    const toId = asString(record.toId);
    const cents = asInt(record.cents);
    const currency = typeof record.currency === 'string' && isCurrency(record.currency) ? record.currency : null;
    const createdAt = asInt(record.createdAt);
    const stampValue = asStamp(record);
    if (
      !id ||
      !fromId ||
      !toId ||
      fromId === toId ||
      cents === null ||
      cents <= 0 ||
      !currency ||
      createdAt === null ||
      !stampValue ||
      record.groupId !== groupId ||
      seen.has(id)
    ) {
      return { ok: false, error: 'This file is not an Everytool split group.' };
    }
    seen.add(id);
    settlements.push({
      id,
      groupId,
      fromId,
      toId,
      cents,
      currency,
      createdAt,
      updatedAt: stampValue.updatedAt,
      deviceId: stampValue.deviceId,
    });
  }
  return { ok: true, settlements };
}

function parseTombstones(
  value: unknown,
  groupId: string,
): { ok: true; tombstones: Tombstone[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'This file is not an Everytool split group.' };
  const tombstones: Tombstone[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = asObject(entry);
    if (!record) return { ok: false, error: 'This file is not an Everytool split group.' };
    const id = asString(record.id);
    const stampValue = asStamp(record);
    const kind = record.kind;
    if (
      !id ||
      !stampValue ||
      record.groupId !== groupId ||
      (kind !== 'group' && kind !== 'person' && kind !== 'expense' && kind !== 'settlement')
    ) {
      return { ok: false, error: 'This file is not an Everytool split group.' };
    }
    const key = tombKey(kind, id);
    if (seen.has(key)) return { ok: false, error: 'This file is not an Everytool split group.' };
    seen.add(key);
    tombstones.push({ id, groupId, kind, updatedAt: stampValue.updatedAt, deviceId: stampValue.deviceId });
  }
  return { ok: true, tombstones };
}

function filePeople(people: Person[], fallback: SyncStamp): SplitFilePerson[] {
  return people.map((person) => {
    const stampValue = publishStamp(person, fallback);
    return {
      id: person.id,
      name: person.name,
      isYou: person.isYou === true,
      updatedAt: stampValue.updatedAt,
      deviceId: stampValue.deviceId,
    };
  });
}

function fileExpense(expense: Expense, fallback: SyncStamp): SplitFileExpense {
  const stampValue = publishStamp(expense, fallback);
  const next: SplitFileExpense = {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    amountCents: expense.amountCents,
    currency: expense.currency,
    payers: expense.payers.map((payer) => ({ personId: payer.personId, cents: payer.cents })),
    split: {
      method: expense.split.method,
      lines: expense.split.lines.map((line) => ({ personId: line.personId, value: line.value })),
    },
    createdAt: expense.createdAt,
    updatedAt: stampValue.updatedAt,
    deviceId: stampValue.deviceId,
  };
  if (expense.receipt) next.receipt = copyReceipt(expense.receipt);
  return next;
}

function fileSettlement(settlement: Settlement, fallback: SyncStamp): SplitFileSettlement {
  const stampValue = publishStamp(settlement, fallback);
  return {
    id: settlement.id,
    groupId: settlement.groupId,
    fromId: settlement.fromId,
    toId: settlement.toId,
    cents: settlement.cents,
    currency: settlement.currency,
    createdAt: settlement.createdAt,
    updatedAt: stampValue.updatedAt,
    deviceId: stampValue.deviceId,
  };
}

export function exportGroupFile(
  ledger: SplitLedger,
  groupId: string,
  meta: { deviceId: string; exportedAt: number },
): { ok: true; text: string; fileName: string } | { ok: false; error: string } {
  if (!meta.deviceId || !Number.isInteger(meta.exportedAt)) {
    return { ok: false, error: 'Missing stamp' };
  }
  const group = ledger.groups.find((entry) => entry.id === groupId) ?? null;
  const tombs = (ledger.tombstones ?? []).filter((tomb) => tomb.groupId === groupId);
  if (!group && tombs.length === 0) return { ok: false, error: 'Group not found' };
  const fallback: SyncStamp = { updatedAt: meta.exportedAt, deviceId: meta.deviceId };
  const people = group
    ? filePeople(
        [...group.people].sort((a, b) => {
          if (a.isYou === b.isYou) return cmp(a.id, b.id);
          return a.isYou ? -1 : 1;
        }),
        fallback,
      )
    : [];
  const groupStamp = group ? publishStamp(group, fallback) : null;
  const file: SplitGroupFile = {
    schema: SPLIT_FILE_SCHEMA,
    kind: SPLIT_FILE_KIND,
    extension: SPLIT_FILE_EXTENSION,
    deviceId: meta.deviceId,
    exportedAt: meta.exportedAt,
    groupId,
    group: group
      ? {
          id: group.id,
          name: group.name,
          currency: group.currency,
          createdAt: group.createdAt,
          updatedAt: groupStamp!.updatedAt,
          deviceId: groupStamp!.deviceId,
          people,
        }
      : null,
    expenses: group
      ? ledger.expenses
          .filter((expense) => expense.groupId === groupId)
          .sort((a, b) => cmp(a.id, b.id))
          .map((expense) => fileExpense(expense, fallback))
      : [],
    settlements: group
      ? ledger.settlements
          .filter((settlement) => settlement.groupId === groupId)
          .sort((a, b) => cmp(a.id, b.id))
          .map((settlement) => fileSettlement(settlement, fallback))
      : [],
    tombstones: [...tombs].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.id, b.id)),
  };
  return {
    ok: true,
    text: JSON.stringify(file),
    fileName: fileNameForGroup(group?.name ?? 'Group'),
  };
}

export function serializeLedger(ledger: SplitLedger): string {
  return JSON.stringify({
    schema: SPLIT_FILE_SCHEMA,
    deviceId: ledger.deviceId ?? '',
    groups: ledger.groups,
    expenses: ledger.expenses,
    settlements: ledger.settlements,
    tombstones: ledger.tombstones ?? [],
  });
}

export function parseStoredLedger(
  text: string | null,
): { ok: true; ledger: SplitLedger } | { ok: false; error: string } {
  if (text == null || text.trim() === '') return { ok: true, ledger: emptyLedger() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The split groups on this phone could not be read.' };
  }
  const root = asObject(raw);
  if (!root) return { ok: false, error: 'The split groups on this phone could not be read.' };
  const schema = asInt(root.schema);
  if (schema !== null && schema > SPLIT_FILE_SCHEMA) {
    return { ok: false, error: 'These split groups are from a newer Everytool. Update the app before importing.' };
  }
  if (!Array.isArray(root.groups) || !Array.isArray(root.expenses) || !Array.isArray(root.settlements)) {
    return { ok: false, error: 'The split groups on this phone could not be read.' };
  }
  const ledger: SplitLedger = {
    groups: root.groups as SplitGroup[],
    expenses: root.expenses as Expense[],
    settlements: root.settlements as Settlement[],
    tombstones: Array.isArray(root.tombstones) ? (root.tombstones as Tombstone[]) : [],
  };
  if (typeof root.deviceId === 'string' && root.deviceId) ledger.deviceId = root.deviceId;
  return { ok: true, ledger };
}

function totalLine(row: PersonBalance): string {
  const money = formatCents(Math.abs(row.netCents), row.currency);
  if (row.netCents > 0) return row.isYou ? `You are owed ${money}` : `${row.name} is owed ${money}`;
  if (row.netCents < 0) return row.isYou ? `You owe ${money}` : `${row.name} owes ${money}`;
  return row.isYou ? 'You are settled' : `${row.name} is settled`;
}

/** Who owes whom, plus one total per person. Plain text for the share sheet. */
export function groupSummary(ledger: SplitLedger, groupId: string): SummaryShare | null {
  const group = ledger.groups.find((entry) => entry.id === groupId);
  if (!group) return null;
  const owe = whoOwesWhom(ledger, groupId);
  const oweLines = owe.lines.length > 0 ? owe.lines.map((line) => line.text) : ['Everyone is settled up.'];
  const totals: SummaryTotal[] = balances(ledger, groupId).map((row) => ({
    name: row.isYou ? 'You' : row.name,
    text: totalLine(row),
    tone: row.netCents > 0 ? 'owed' : row.netCents < 0 ? 'owes' : 'settled',
    netCents: row.netCents,
    currency: row.currency,
  }));
  return {
    title: group.name,
    oweLines,
    totals,
    text: [group.name, 'Who owes whom', ...oweLines, '', 'Totals', ...totals.map((row) => row.text)].join('\n'),
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
