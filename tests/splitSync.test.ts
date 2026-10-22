import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodePngRows } from '../src/lib/deflate.ts';
import { isSplitFileUrl, routeIncomingUrl, SPLIT_OPEN_EXTENSION } from '../src/lib/pdfOpen.ts';
import { renderSummaryPng } from '../src/lib/splitSummaryPng.ts';
import { shareItem } from '../src/lib/shareSheet.ts';
import {
  SPLIT_FILE_EXTENSION,
  SPLIT_FILE_KIND,
  SPLIT_FILE_MIME,
  SPLIT_FILE_SCHEMA,
  SPLIT_FILE_UTI,
  SPLIT_LEDGER_STORAGE_KEY,
  addExpense,
  addGroup,
  addPerson,
  addSettlement,
  applyGroupImport,
  deleteExpense,
  deleteGroup,
  deletePerson,
  emptyLedger,
  exportGroupFile,
  fileNameForGroup,
  groupSummary,
  parseGroupFile,
  parseStoredLedger,
  previewGroupImport,
  serializeLedger,
  type SplitGroupFile,
  type SplitLedger,
} from '../src/lib/splitwise.ts';

const PHONE_A = { deviceId: 'phone-a', exportedAt: 500 };
const PHONE_B = { deviceId: 'phone-b', exportedAt: 500 };

function must<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  assert.equal(result.ok, true);
}

function trip(): SplitLedger {
  let ledger = emptyLedger();
  const group = addGroup(ledger, {
    id: 'g',
    name: 'Lisbon trip',
    youId: 'you',
    currency: 'USD',
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'phone-a',
  });
  must(group);
  ledger = group.ledger;
  const alex = addPerson(ledger, 'g', { id: 'alex', name: 'Alex', updatedAt: 1, deviceId: 'phone-a' });
  must(alex);
  ledger = alex.ledger;
  const dinner = addExpense(ledger, {
    id: 'dinner',
    groupId: 'g',
    description: 'Dinner',
    amountCents: 4000,
    payers: [{ personId: 'alex', cents: 4000 }],
    split: {
      method: 'equal',
      lines: [
        { personId: 'you', value: 1 },
        { personId: 'alex', value: 1 },
      ],
    },
    createdAt: 2,
    updatedAt: 2,
    deviceId: 'phone-a',
  });
  must(dinner);
  return dinner.ledger;
}

function fileOf(ledger: SplitLedger, meta: { deviceId: string; exportedAt: number } = PHONE_A): SplitGroupFile {
  const exported = exportGroupFile(ledger, 'g', meta);
  must(exported);
  const parsed = parseGroupFile(exported.text);
  must(parsed);
  return parsed.file;
}

function withDinner(
  ledger: SplitLedger,
  patch: { description?: string; updatedAt: number; deviceId: string },
): SplitLedger {
  return {
    ...ledger,
    expenses: ledger.expenses.map((expense) =>
      expense.id === 'dinner' ? { ...expense, description: patch.description ?? expense.description, updatedAt: patch.updatedAt, deviceId: patch.deviceId } : expense,
    ),
  };
}

test('group file declares schema 1 and the .etsplit UTI', () => {
  assert.equal(SPLIT_FILE_SCHEMA, 1);
  assert.equal(SPLIT_FILE_EXTENSION, 'etsplit');
  assert.equal(SPLIT_OPEN_EXTENSION, SPLIT_FILE_EXTENSION);
  assert.equal(SPLIT_FILE_UTI, 'app.everytool.ios.etsplit');
  assert.equal(SPLIT_FILE_KIND, SPLIT_FILE_UTI);
  assert.equal(SPLIT_FILE_MIME, 'application/vnd.everytool.etsplit+json');
  assert.equal(SPLIT_LEDGER_STORAGE_KEY, 'everytool.split-ledger.v1');
  assert.equal(fileNameForGroup('Lisbon trip'), 'Lisbon trip.etsplit');

  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
    expo: { ios: { infoPlist: Record<string, unknown> } };
  };
  const plist = app.expo.ios.infoPlist;
  const exported = plist.UTExportedTypeDeclarations as {
    UTTypeIdentifier: string;
    UTTypeTagSpecification: { 'public.filename-extension': string[]; 'public.mime-type': string };
  }[];
  assert.equal(exported[0]!.UTTypeIdentifier, SPLIT_FILE_UTI);
  assert.deepEqual(exported[0]!.UTTypeTagSpecification['public.filename-extension'], ['etsplit']);
  assert.equal(exported[0]!.UTTypeTagSpecification['public.mime-type'], SPLIT_FILE_MIME);
  const types = plist.CFBundleDocumentTypes as {
    CFBundleTypeRole: string;
    LSHandlerRank: string;
    LSItemContentTypes: string[];
  }[];
  const split = types.find((entry) => entry.LSItemContentTypes.includes(SPLIT_FILE_UTI));
  assert.ok(split);
  assert.equal(split!.CFBundleTypeRole, 'Editor');
  assert.equal(split!.LSHandlerRank, 'Owner');
  assert.equal(isSplitFileUrl('file:///tmp/Lisbon%20trip.etsplit'), true);
  assert.equal(routeIncomingUrl('file:///tmp/Lisbon%20trip.ETSPLIT').kind, 'split');
  assert.equal(routeIncomingUrl('file:///tmp/notes.everytool').kind, 'ignore');
});

test('importing an unknown group creates it, and a second import adds nothing', () => {
  const file = fileOf(trip());
  const preview = previewGroupImport(emptyLedger(), file);
  assert.equal(preview.summary, '4 new, 0 updated, 0 removed');
  const applied = applyGroupImport(emptyLedger(), file);
  must(applied);
  assert.equal(applied.ledger.groups[0]?.name, 'Lisbon trip');
  assert.equal(applied.ledger.groups[0]?.people.length, 2);
  assert.equal(applied.ledger.expenses.length, 1);
  assert.equal(applied.ledger.expenses.filter((expense) => expense.id === 'dinner').length, 1);

  const again = applyGroupImport(applied.ledger, file);
  must(again);
  assert.equal(again.preview.summary, '0 new, 0 updated, 0 removed');
  assert.equal(again.ledger.expenses.length, 1);
  assert.equal(exportGroupFile(applied.ledger, 'g', PHONE_A).ok && exportGroupFile(again.ledger, 'g', PHONE_A).ok, true);
  const first = exportGroupFile(applied.ledger, 'g', PHONE_A);
  const second = exportGroupFile(again.ledger, 'g', PHONE_A);
  must(first);
  must(second);
  assert.equal(second.text, first.text);
});

test('round-trip keeps items, a receipt, a settlement, and a tombstone', () => {
  let ledger = trip();
  const withReceipt = addExpense(ledger, {
    id: 'soup',
    groupId: 'g',
    description: "Sam's soup",
    amountCents: 4000,
    payers: [{ personId: 'you', cents: 4000 }],
    split: {
      method: 'equal',
      lines: [
        { personId: 'you', value: 1 },
        { personId: 'alex', value: 1 },
      ],
    },
    receipt: {
      items: [{ id: 'bowl', name: 'Soup', cents: 4000, personIds: [] }],
      tax: { kind: 'amount', value: 0 },
      tip: { kind: 'amount', value: 0 },
      everyoneIds: ['you', 'alex'],
    },
    createdAt: 4,
    updatedAt: 4,
    deviceId: 'phone-a',
  });
  must(withReceipt);
  ledger = withReceipt.ledger;
  const paid = addSettlement(ledger, {
    id: 'paid',
    groupId: 'g',
    fromId: 'you',
    toId: 'alex',
    cents: 2000,
    createdAt: 5,
    updatedAt: 5,
    deviceId: 'phone-a',
  });
  must(paid);
  ledger = paid.ledger;
  const removed = deletePerson(ledger, 'g', 'alex', { updatedAt: 9, deviceId: 'phone-a' });
  must(removed);
  ledger = removed.ledger;
  const exported = exportGroupFile(ledger, 'g', PHONE_A);
  must(exported);
  assert.equal(exported.fileName, 'Lisbon trip.etsplit');
  const parsed = parseGroupFile(exported.text);
  must(parsed);
  assert.equal(parsed.file.schema, 1);
  assert.equal(parsed.file.tombstones.some((tomb) => tomb.kind === 'person' && tomb.id === 'alex'), true);
  const applied = applyGroupImport(emptyLedger(), parsed.file);
  must(applied);
  assert.equal(applied.ledger.groups[0]?.people.some((person) => person.id === 'alex'), false);
  assert.equal(applied.ledger.expenses.some((expense) => expense.id === 'soup' && expense.receipt?.items[0]?.name === 'Soup'), true);
  const again = exportGroupFile(applied.ledger, 'g', PHONE_A);
  must(again);
  assert.equal(again.text, exported.text);
});

test('conflicting edits: later updatedAt wins, deviceId breaks a tie', () => {
  const local = withDinner(trip(), { description: 'Lunch', updatedAt: 30, deviceId: 'phone-a' });
  const remote = withDinner(trip(), { description: 'Gelato', updatedAt: 40, deviceId: 'phone-b' });
  const preview = previewGroupImport(local, fileOf(remote, PHONE_B));
  assert.equal(preview.summary, '0 new, 1 updated, 0 removed');
  const applied = applyGroupImport(local, fileOf(remote, PHONE_B));
  must(applied);
  assert.equal(applied.ledger.expenses.find((expense) => expense.id === 'dinner')?.description, 'Gelato');

  const tiedLocal = withDinner(trip(), { description: 'Lunch', updatedAt: 10, deviceId: 'aaa' });
  const tiedRemote = withDinner(trip(), { description: 'Gelato', updatedAt: 10, deviceId: 'bbb' });
  const tie = applyGroupImport(tiedLocal, fileOf(tiedRemote, { deviceId: 'bbb', exportedAt: 10 }));
  must(tie);
  assert.equal(tie.preview.summary, '0 new, 1 updated, 0 removed');
  assert.equal(tie.ledger.expenses.find((expense) => expense.id === 'dinner')?.description, 'Gelato');

  const olderDevice = applyGroupImport(tiedRemote, fileOf(tiedLocal, { deviceId: 'aaa', exportedAt: 10 }));
  must(olderDevice);
  assert.equal(olderDevice.preview.summary, '0 new, 0 updated, 0 removed');
  assert.equal(olderDevice.ledger.expenses.find((expense) => expense.id === 'dinner')?.description, 'Gelato');

  const earlier = withDinner(trip(), { description: 'Old', updatedAt: 40, deviceId: 'zzz' });
  const later = withDinner(trip(), { description: 'New', updatedAt: 50, deviceId: 'aaa' });
  const timeWins = applyGroupImport(earlier, fileOf(later, PHONE_A));
  must(timeWins);
  assert.equal(timeWins.ledger.expenses.find((expense) => expense.id === 'dinner')?.description, 'New');
});

test('adds, an edit, and a delete count as 3 new, 1 updated, 0 removed', () => {
  const local = trip();
  let remote = withDinner(trip(), { description: 'Dinner out', updatedAt: 8, deviceId: 'phone-b' });
  for (const [id, description] of [
    ['gelato', 'Gelato'],
    ['tickets', 'Tickets'],
    ['taxi', 'Taxi'],
  ] as const) {
    const added = addExpense(remote, {
      id,
      groupId: 'g',
      description,
      amountCents: 1000,
      payers: [{ personId: 'you', cents: 1000 }],
      split: {
        method: 'equal',
        lines: [
          { personId: 'you', value: 1 },
          { personId: 'alex', value: 1 },
        ],
      },
      createdAt: 6,
      updatedAt: 6,
      deviceId: 'phone-b',
    });
    must(added);
    remote = added.ledger;
  }
  const before = serializeLedger(local);
  const preview = previewGroupImport(local, fileOf(remote, PHONE_B));
  assert.equal(serializeLedger(local), before);
  assert.equal(preview.summary, '3 new, 1 updated, 0 removed');
  const applied = applyGroupImport(local, fileOf(remote, PHONE_B));
  must(applied);
  assert.equal(applied.preview.summary, '3 new, 1 updated, 0 removed');
  assert.equal(applied.ledger.expenses.length, 4);
  assert.equal(new Set(applied.ledger.expenses.map((expense) => expense.id)).size, 4);
  assert.equal(applied.ledger.expenses.find((expense) => expense.id === 'dinner')?.description, 'Dinner out');
});

test('deletes win through tombstones and do not come back or duplicate', () => {
  const original = trip();
  const removed = deleteExpense(original, 'dinner', { updatedAt: 20, deviceId: 'phone-a' });
  must(removed);
  const file = fileOf(removed.ledger);
  const preview = previewGroupImport(original, file);
  assert.equal(preview.summary, '0 new, 0 updated, 1 removed');
  const applied = applyGroupImport(original, file);
  must(applied);
  assert.equal(applied.ledger.expenses.length, 0);
  assert.equal(applied.ledger.tombstones?.some((tomb) => tomb.id === 'dinner'), true);

  const replay = applyGroupImport(applied.ledger, file);
  must(replay);
  assert.equal(replay.preview.summary, '0 new, 0 updated, 0 removed');
  assert.equal(replay.ledger.expenses.length, 0);

  const older = withDinner(original, { description: 'Dinner', updatedAt: 5, deviceId: 'phone-b' });
  const stuck = applyGroupImport(applied.ledger, fileOf(older, PHONE_B));
  must(stuck);
  assert.equal(stuck.preview.summary, '0 new, 0 updated, 0 removed');
  assert.equal(stuck.ledger.expenses.length, 0);

  const newer = withDinner(original, { description: 'Dinner again', updatedAt: 30, deviceId: 'phone-b' });
  const back = applyGroupImport(applied.ledger, fileOf(newer, PHONE_B));
  must(back);
  assert.equal(back.preview.summary, '1 new, 0 updated, 0 removed');
  assert.equal(back.ledger.expenses.filter((expense) => expense.id === 'dinner').length, 1);
  assert.equal(back.ledger.tombstones?.some((tomb) => tomb.id === 'dinner'), false);
});

test('deleting a person or the whole group is a tombstone, and another group stays', () => {
  let ledger = trip();
  const other = addGroup(ledger, { id: 'home', name: 'Home', youId: 'you', createdAt: 1 });
  must(other);
  ledger = other.ledger;
  const gone = deletePerson(ledger, 'g', 'alex', { updatedAt: 12, deviceId: 'phone-a' });
  must(gone);
  const personFile = fileOf(gone.ledger);
  const personMerge = applyGroupImport(ledger, personFile);
  must(personMerge);
  assert.equal(personMerge.preview.summary, '0 new, 0 updated, 1 removed');
  assert.equal(personMerge.ledger.groups.find((group) => group.id === 'g')?.people.some((person) => person.id === 'alex'), false);
  assert.equal(personMerge.ledger.groups.some((group) => group.id === 'home'), true);

  const wiped = deleteGroup(trip(), 'g', { updatedAt: 15, deviceId: 'phone-a' });
  must(wiped);
  const groupFile = fileOf(wiped.ledger);
  const groupMerge = applyGroupImport(trip(), groupFile);
  must(groupMerge);
  assert.equal(groupMerge.preview.summary, '0 new, 0 updated, 4 removed');
  assert.equal(groupMerge.ledger.groups.length, 0);
  assert.equal(groupMerge.ledger.expenses.length, 0);
});

test('a bad file is refused, and a stored ledger round-trips', () => {
  assert.equal(parseGroupFile('hello').ok, false);
  const newer = parseGroupFile(JSON.stringify({ schema: 2, kind: SPLIT_FILE_KIND }));
  assert.equal(newer.ok, false);
  if (!newer.ok) assert.match(newer.error, /newer Everytool/);
  assert.equal(parseGroupFile('{"schema":1}').ok, false);

  const stored = parseStoredLedger(null);
  must(stored);
  assert.deepEqual(stored.ledger, emptyLedger());
  const saved = serializeLedger(assignForStore(trip()));
  const loaded = parseStoredLedger(saved);
  must(loaded);
  assert.equal(loaded.ledger.groups[0]?.name, 'Lisbon trip');
  assert.equal(parseStoredLedger('{"schema":2}').ok, false);
});

test('summary share is who owes whom plus per-person totals, as text and a PNG', () => {
  const summary = groupSummary(trip(), 'g');
  assert.ok(summary);
  assert.equal(
    summary!.text,
    ['Lisbon trip', 'Who owes whom', 'You owe Alex $20.00', '', 'Totals', 'You owe $20.00', 'Alex is owed $20.00'].join('\n'),
  );
  const png = renderSummaryPng(summary!);
  assert.equal(png[0], 0x89);
  assert.equal(String.fromCharCode(...png.subarray(1, 4)), 'PNG');
  let sawOrange = false;
  let sawRed = false;
  let sawGreen = false;
  const info = decodePngRows(png, (_y, row) => {
    for (let i = 0; i < row.length; i += 4) {
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      if (r === 245 && g === 134 && b === 31) sawOrange = true;
      if (r === 215 && g === 0 && b === 21) sawRed = true;
      if (r === 36 && g === 138 && b === 61) sawGreen = true;
    }
  });
  assert.equal(info.width, 780);
  assert.ok(info.height > 200);
  assert.equal(sawOrange, true);
  assert.equal(sawRed, true);
  assert.equal(sawGreen, true);
  const image = shareItem({ uri: 'file:///tmp/summary.png', mimeType: 'image/png', text: summary!.text });
  assert.equal(image.url, 'file:///tmp/summary.png');
  assert.equal('message' in image, false);
  const text = shareItem({ text: summary!.text });
  assert.equal(text.message, summary!.text);
  const groupFile = shareItem({
    uri: 'file:///tmp/Lisbon trip.etsplit',
    mimeType: SPLIT_FILE_MIME,
  });
  assert.equal(groupFile.url, 'file:///tmp/Lisbon trip.etsplit');
});

function assignForStore(ledger: SplitLedger): SplitLedger {
  return { ...ledger, deviceId: 'this-phone' };
}
