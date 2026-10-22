import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExpense,
  addGroup,
  addPerson,
  addSettlement,
  balances,
  emptyLedger,
  formatCents,
  personNameFromContact,
  prefillFromReceipt,
  previewItems,
  previewPayers,
  previewSplit,
  simplifyDebts,
  whoOwesWhom,
  type SplitLedger,
} from '../src/lib/splitwise.ts';

function cents(shares: { cents: number }[]): number[] {
  return shares.map((share) => share.cents);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function lisbon(): SplitLedger {
  let ledger = emptyLedger();
  ledger = addGroup(ledger, { id: 'g', name: 'Lisbon trip', youId: 'you', currency: 'USD', createdAt: 1 }).ledger;
  ledger = addPerson(ledger, 'g', { id: 'alex', name: 'Alex' }).ledger;
  ledger = addPerson(ledger, 'g', { id: 'sam', name: 'Sam' }).ledger;
  return ledger;
}

test('equal deals leftover cents to the first people', () => {
  const ten = previewSplit({
    amountCents: 1000,
    method: 'equal',
    lines: ['a', 'b', 'c'].map((personId) => ({ personId, value: 1 })),
  });
  assert.equal(ten.ok, true);
  assert.deepEqual(cents(ten.shares), [334, 333, 333]);
  assert.equal(sum(cents(ten.shares)), 1000);

  const penny = previewSplit({
    amountCents: 1,
    method: 'equal',
    lines: ['a', 'b'].map((personId) => ({ personId, value: 1 })),
  });
  assert.deepEqual(cents(penny.shares), [1, 0]);
  assert.equal(previewSplit({ amountCents: 1000, method: 'equal', lines: [] }).ok, false);
});

test('exact amounts report what is left and what is over', () => {
  const lines = [
    { personId: 'a', value: 4000 },
    { personId: 'b', value: 3600 },
    { personId: 'c', value: 1800 },
  ];
  const over = previewSplit({ amountCents: 9000, method: 'exact', lines });
  assert.equal(over.ok, false);
  assert.equal(over.remainingCents, -400);
  assert.equal(over.message, '$4.00 over');

  const left = previewSplit({
    amountCents: 9000,
    method: 'exact',
    lines: lines.map((line, i) => (i === 2 ? { ...line, value: 1000 } : line)),
  });
  assert.equal(left.remainingCents, 400);
  assert.equal(left.message, '$4.00 still to assign');

  const match = previewSplit({
    amountCents: 9000,
    method: 'exact',
    lines: lines.map((line, i) => (i === 2 ? { ...line, value: 1400 } : line)),
  });
  assert.equal(match.ok, true);
  assert.equal(match.remainingCents, 0);
  assert.equal(sum(cents(match.shares)), 9000);
});

test('percentages use basis points and largest remainder', () => {
  const evenThirds = previewSplit({
    amountCents: 1000,
    method: 'percent',
    lines: [
      { personId: 'a', value: 3334 },
      { personId: 'b', value: 3333 },
      { personId: 'c', value: 3333 },
    ],
  });
  assert.equal(evenThirds.ok, true);
  assert.equal(evenThirds.remainingBps, 0);
  assert.deepEqual(cents(evenThirds.shares), [334, 333, 333]);

  const over = previewSplit({
    amountCents: 1000,
    method: 'percent',
    lines: [
      { personId: 'a', value: 6000 },
      { personId: 'b', value: 5000 },
    ],
  });
  assert.equal(over.ok, false);
  assert.equal(over.remainingBps, -1000);
  assert.equal(over.remainingCents, -100);
  assert.equal(over.message, '10.00% over');

  const left = previewSplit({
    amountCents: 10_000,
    method: 'percent',
    lines: [
      { personId: 'a', value: 5000 },
      { personId: 'b', value: 4750 },
    ],
  });
  assert.equal(left.remainingBps, 250);
  assert.equal(left.remainingCents, 250);
  assert.equal(left.message, '2.50% still to assign');
});

test('shares split by weight, including a 3-and-1 remainder', () => {
  const three = previewSplit({
    amountCents: 100,
    method: 'shares',
    lines: ['a', 'b', 'c'].map((personId) => ({ personId, value: 1 })),
  });
  assert.deepEqual(cents(three.shares), [34, 33, 33]);

  const weighted = previewSplit({
    amountCents: 10,
    method: 'shares',
    lines: [
      { personId: 'a', value: 3 },
      { personId: 'b', value: 1 },
    ],
  });
  assert.deepEqual(cents(weighted.shares), [8, 2]);
  assert.equal(sum(cents(weighted.shares)), 10);
  assert.equal(
    previewSplit({
      amountCents: 100,
      method: 'shares',
      lines: [{ personId: 'a', value: 0 }],
    }).ok,
    false,
  );
});

test('adjustment splits the leftover equally and rejects a negative share', () => {
  const ok = previewSplit({
    amountCents: 9000,
    method: 'adjustment',
    lines: [
      { personId: 'a', value: 1000 },
      { personId: 'b', value: 0 },
      { personId: 'c', value: 0 },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.remainingCents, 8000);
  assert.equal(ok.message, '$80.00 split equally');
  assert.deepEqual(cents(ok.shares), [3667, 2667, 2666]);
  assert.equal(sum(cents(ok.shares)), 9000);

  const below = previewSplit({
    amountCents: 300,
    method: 'adjustment',
    lines: [
      { personId: 'a', value: -400 },
      { personId: 'b', value: 0 },
    ],
  });
  assert.equal(below.ok, false);
  assert.equal(below.message, 'A share is below zero');
  assert.equal(below.shares[0]?.cents, -50);

  const over = previewSplit({
    amountCents: 300,
    method: 'adjustment',
    lines: [{ personId: 'a', value: 400 }],
  });
  assert.equal(over.ok, false);
  assert.equal(over.remainingCents, -100);
  assert.equal(over.message, '$1.00 over');
});

test('payers track remaining and over, including two payers', () => {
  assert.equal(previewPayers(9000, []).message, 'Choose who paid');
  const left = previewPayers(9000, [
    { personId: 'a', cents: 6000 },
    { personId: 'b', cents: 2000 },
  ]);
  assert.equal(left.ok, false);
  assert.equal(left.remainingCents, 1000);
  const over = previewPayers(9000, [{ personId: 'a', cents: 9500 }]);
  assert.equal(over.remainingCents, -500);
  assert.equal(over.message, '$5.00 over');
  const paid = previewPayers(9000, [
    { personId: 'a', cents: 6000 },
    { personId: 'b', cents: 3000 },
  ]);
  assert.equal(paid.ok, true);
});

test('tax and tip follow item weights and reconcile to the cent', () => {
  const preview = previewItems({
    peopleIds: ['you', 'alex'],
    items: [
      { cents: 400, personIds: ['you'] },
      { cents: 600, personIds: ['you', 'alex'] },
      { cents: 2200, personIds: ['alex'] },
    ],
    tax: { kind: 'percent', value: 1000 },
    tip: { kind: 'percent', value: 1800 },
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.itemsCents, 3200);
  assert.equal(preview.taxCents, 320);
  assert.equal(preview.tipCents, 576);
  assert.equal(preview.grandCents, 4096);
  assert.deepEqual(cents(preview.itemShares), [700, 2500]);
  assert.deepEqual(cents(preview.taxShares), [70, 250]);
  assert.deepEqual(cents(preview.tipShares), [126, 450]);
  assert.deepEqual(cents(preview.shares), [896, 3200]);
  assert.equal(sum(cents(preview.shares)), preview.grandCents);
});

test('a shared item with an odd cent, and a one-cent tax, go to the first person', () => {
  const preview = previewItems({
    peopleIds: ['a', 'b'],
    items: [{ cents: 101, personIds: [] }],
    tax: { kind: 'amount', value: 1 },
    tip: { kind: 'amount', value: 0 },
  });
  assert.deepEqual(cents(preview.itemShares), [51, 50]);
  assert.deepEqual(cents(preview.taxShares), [1, 0]);
  assert.deepEqual(cents(preview.shares), [52, 50]);
  assert.equal(sum(cents(preview.shares)), 102);
});

test('tip percent is of the items, not of tax', () => {
  const preview = previewItems({
    peopleIds: ['a'],
    items: [{ cents: 5000, personIds: ['a'] }],
    tax: { kind: 'amount', value: 500 },
    tip: { kind: 'percent', value: 1000 },
  });
  assert.equal(preview.tipCents, 500);
  assert.equal(preview.grandCents, 6000);
});

test('tip rounding uses half-up cents, then largest remainder', () => {
  const preview = previewItems({
    peopleIds: ['a', 'b'],
    items: [
      { cents: 1111, personIds: ['a'] },
      { cents: 2222, personIds: ['b'] },
    ],
    tax: { kind: 'amount', value: 0 },
    tip: { kind: 'percent', value: 1800 },
  });
  assert.equal(preview.tipCents, 600);
  assert.equal(sum(cents(preview.tipShares)), 600);
  assert.equal(sum(cents(preview.shares)), preview.grandCents);
});

test('receipt prefill keeps items and lifts tax and tip', () => {
  const prefill = prefillFromReceipt([
    { name: '  Pastel   de nata', cents: 400, role: 'item' },
    { name: 'Subtotal', cents: 400, role: 'subtotal' },
    { name: 'Tax', cents: 40, role: 'tax' },
    { name: 'Tip', cents: 72, role: 'tip' },
    { name: 'Total', cents: 512, role: 'total' },
    { name: ' ', cents: 100, role: 'item' },
  ]);
  assert.deepEqual(prefill.items, [{ name: 'Pastel de nata', cents: 400 }]);
  assert.equal(prefill.taxCents, 40);
  assert.equal(prefill.tipCents, 72);
});

test('a new group starts with You, and contact names are trimmed', () => {
  const created = addGroup(emptyLedger(), { id: 'g', name: 'Lisbon trip', youId: 'you' });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.deepEqual(created.ledger.groups[0]?.people, [{ id: 'you', name: 'You', isYou: true }]);
  assert.equal(created.ledger.groups[0]?.currency, 'USD');
  assert.equal(personNameFromContact('  Ada   Lovelace '), 'Ada Lovelace');
  assert.equal(personNameFromContact('   '), null);
  const added = addPerson(created.ledger, 'g', { id: 'ada', name: '  Ada   Lovelace ' });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.ledger.groups[0]?.people[1]?.name, 'Ada Lovelace');
  assert.equal(created.ledger.groups[0]?.people.length, 1);
});

test('group balances, a collapsed debt chain, and a settlement that clears it', () => {
  let ledger = lisbon();
  const dinner = addExpense(ledger, {
    id: 'dinner',
    groupId: 'g',
    description: 'Dinner',
    amountCents: 9000,
    payers: [{ personId: 'alex', cents: 9000 }],
    split: {
      method: 'equal',
      lines: ['you', 'alex', 'sam'].map((personId) => ({ personId, value: 1 })),
    },
    createdAt: 2,
  });
  assert.equal(dinner.ok, true);
  ledger = dinner.ledger;
  const owes = whoOwesWhom(ledger, 'g');
  assert.deepEqual(
    owes.lines.map((line) => line.text),
    ['Sam owes Alex $30.00', 'You owe Alex $30.00'],
  );
  assert.equal(sum(balances(ledger, 'g').map((row) => row.netCents)), 0);

  const chain = addGroup(emptyLedger(), { id: 'c', name: 'Chain', youId: 'a', createdAt: 1 });
  let chained = chain.ledger;
  chained = addPerson(chained, 'c', { id: 'b', name: 'B' }).ledger;
  chained = addPerson(chained, 'c', { id: 'c', name: 'C' }).ledger;
  chained = addExpense(chained, {
    id: 'e1',
    groupId: 'c',
    amountCents: 1000,
    payers: [{ personId: 'b', cents: 1000 }],
    split: {
      method: 'equal',
      lines: ['a', 'b'].map((personId) => ({ personId, value: 1 })),
    },
  }).ledger;
  chained = addExpense(chained, {
    id: 'e2',
    groupId: 'c',
    amountCents: 1000,
    payers: [{ personId: 'c', cents: 1000 }],
    split: {
      method: 'equal',
      lines: ['b', 'c'].map((personId) => ({ personId, value: 1 })),
    },
  }).ledger;
  const simplified = simplifyDebts(balances(chained, 'c'));
  assert.deepEqual(simplified, [{ fromId: 'a', toId: 'c', cents: 500, currency: 'USD' }]);

  const settled = addSettlement(ledger, {
    id: 's1',
    groupId: 'g',
    fromId: 'you',
    toId: 'alex',
    cents: 3000,
  });
  assert.equal(settled.ok, true);
  ledger = settled.ledger;
  const after = whoOwesWhom(ledger, 'g');
  assert.deepEqual(
    after.lines.map((line) => line.text),
    ['Sam owes Alex $30.00'],
  );
  ledger = addSettlement(ledger, {
    id: 's2',
    groupId: 'g',
    fromId: 'sam',
    toId: 'alex',
    cents: 3000,
  }).ledger;
  assert.equal(whoOwesWhom(ledger, 'g').text, 'Lisbon trip\nWho owes whom\nEveryone is settled up.');
});

test('simplify is deterministic on ties and never mixes currencies', () => {
  const transfers = simplifyDebts([
    { personId: 'a', currency: 'USD', netCents: 1000 },
    { personId: 'b', currency: 'USD', netCents: 1000 },
    { personId: 'c', currency: 'USD', netCents: -2000 },
    { personId: 'a', currency: 'EUR', netCents: -500 },
    { personId: 'b', currency: 'EUR', netCents: 500 },
  ]);
  assert.deepEqual(transfers, [
    { fromId: 'a', toId: 'b', cents: 500, currency: 'EUR' },
    { fromId: 'c', toId: 'a', cents: 1000, currency: 'USD' },
    { fromId: 'c', toId: 'b', cents: 1000, currency: 'USD' },
  ]);
});

test('applying simplified debts clears every balance', () => {
  const rows = [
    { personId: 'a', currency: 'USD', netCents: 4000 },
    { personId: 'b', currency: 'USD', netCents: -1500 },
    { personId: 'c', currency: 'USD', netCents: -2500 },
    { personId: 'd', currency: 'USD', netCents: 0 },
  ];
  const nets = new Map(rows.map((row) => [row.personId, row.netCents]));
  const transfers = simplifyDebts(rows);
  assert.equal(transfers.length, 2);
  for (const transfer of transfers) {
    nets.set(transfer.fromId, (nets.get(transfer.fromId) ?? 0) + transfer.cents);
    nets.set(transfer.toId, (nets.get(transfer.toId) ?? 0) - transfer.cents);
  }
  assert.deepEqual([...nets.values()], [0, 0, 0, 0]);
});

test('an itemized expense freezes shares, and a bad exact split is refused', () => {
  let ledger = lisbon();
  const saved = addExpense(ledger, {
    id: 'cafe',
    groupId: 'g',
    description: 'Cafe',
    amountCents: 4096,
    payers: [
      { personId: 'you', cents: 2000 },
      { personId: 'alex', cents: 2096 },
    ],
    split: { method: 'equal', lines: [] },
    receipt: {
      items: [
        { id: 'i1', name: 'Pastel de nata', cents: 400, personIds: ['you'] },
        { id: 'i2', name: 'Galao', cents: 600, personIds: ['you', 'alex'] },
        { id: 'i3', name: 'Vinho', cents: 2200, personIds: ['alex'] },
      ],
      tax: { kind: 'percent', value: 1000 },
      tip: { kind: 'percent', value: 1800 },
      everyoneIds: ['you', 'alex'],
    },
  });
  assert.equal(saved.ok, true);
  ledger = saved.ledger;
  const expense = ledger.expenses[0];
  assert.equal(expense?.split.method, 'exact');
  assert.deepEqual(
    expense?.split.lines.map((line) => line.value),
    [896, 3200],
  );
  const nets = balances(ledger, 'g');
  assert.equal(sum(nets.map((row) => row.netCents)), 0);
  assert.equal(nets.find((row) => row.personId === 'you')?.netCents, 2000 - 896);
  assert.equal(nets.find((row) => row.personId === 'sam')?.netCents, 0);

  const refused = addExpense(ledger, {
    id: 'bad',
    groupId: 'g',
    amountCents: 1000,
    payers: [{ personId: 'you', cents: 1000 }],
    split: {
      method: 'exact',
      lines: [
        { personId: 'you', value: 400 },
        { personId: 'alex', value: 400 },
      ],
    },
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error, '$2.00 still to assign');
  assert.equal(refused.ledger.expenses.length, 1);
});

test('two currencies on one trip stay in their own ledgers', () => {
  let ledger = lisbon();
  ledger = addExpense(ledger, {
    id: 'usd',
    groupId: 'g',
    amountCents: 1000,
    currency: 'USD',
    payers: [{ personId: 'alex', cents: 1000 }],
    split: {
      method: 'equal',
      lines: ['you', 'alex'].map((personId) => ({ personId, value: 1 })),
    },
  }).ledger;
  ledger = addExpense(ledger, {
    id: 'eur',
    groupId: 'g',
    amountCents: 500,
    currency: 'EUR',
    payers: [{ personId: 'you', cents: 500 }],
    split: {
      method: 'equal',
      lines: ['you', 'alex'].map((personId) => ({ personId, value: 1 })),
    },
  }).ledger;
  const text = whoOwesWhom(ledger, 'g').text;
  assert.match(text, /Alex owes You €2\.50/);
  assert.match(text, /You owe Alex \$5\.00/);
  assert.equal(text.includes('€5.00'), false);
});

test('money formatting keeps the currency symbol and the sign', () => {
  assert.equal(formatCents(11800), '$118.00');
  assert.equal(formatCents(123456, 'EUR'), '€1,234.56');
  assert.equal(formatCents(-250, 'GBP'), '-£2.50');
  assert.equal(formatCents(99, 'CAD'), 'CA$0.99');
  assert.equal(formatCents(100, 'AUD'), 'A$1.00');
});
