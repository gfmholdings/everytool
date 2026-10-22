import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { loadDeviceId } from '../lib/deviceId';
import { shareFile, shareText, tempFileUri } from '../lib/files';
import { toCents } from '../lib/money';
import { renderSummaryPng } from '../lib/splitSummaryPng';
import {
  CURRENCIES,
  SPLIT_FILE_MIME,
  SPLIT_LEDGER_STORAGE_KEY,
  addExpense,
  addGroup,
  addPerson,
  addSettlement,
  assignDeviceId,
  balances,
  deleteExpense,
  deleteGroup,
  deletePerson,
  emptyLedger,
  expensesInGroup,
  exportGroupFile,
  formatCents,
  groupSummary,
  parseStoredLedger,
  serializeLedger,
  whoOwesWhom,
  type CurrencyCode,
  type SplitLedger,
} from '../lib/splitwise';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';

export type HistoryNav = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
};

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function touch(deviceId: string): { updatedAt: number; deviceId: string } {
  return { updatedAt: Date.now(), deviceId };
}

/**
 * Offline groups: people, equal expenses, balances, and a group file.
 * Even split and by-item stay on the other segments.
 */
export function SplitGroups({
  notify,
  onHistory,
}: {
  notify?: (msg: string, action?: { label: string; onPress: () => void }) => void;
  onHistory: (nav: HistoryNav) => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const hist = useUndoHistory<SplitLedger>(emptyLedger());
  const { present: ledger, commit, undo, redo, reset, canUndo, canRedo } = hist;
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [personName, setPersonName] = useState('');
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [payerId, setPayerId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    onHistory({ canUndo, canRedo, undo, redo });
  }, [canUndo, canRedo, undo, redo, onHistory]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const id = await loadDeviceId();
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(SPLIT_LEDGER_STORAGE_KEY);
      } catch {
        raw = null;
      }
      const parsed = parseStoredLedger(raw);
      if (!live) return;
      setDeviceId(id);
      reset(assignDeviceId(parsed.ok ? parsed.ledger : emptyLedger(), id));
      setReady(true);
      if (!parsed.ok) setNote(parsed.error);
    })();
    return () => {
      live = false;
    };
  }, [reset]);

  useEffect(() => {
    if (!ready) return;
    void AsyncStorage.setItem(SPLIT_LEDGER_STORAGE_KEY, serializeLedger(ledger));
  }, [ledger, ready]);

  const apply = (next: { ok: boolean; ledger: SplitLedger; error?: string }) => {
    if (!next.ok) {
      setNote(next.error ?? 'That didn’t work.');
      return false;
    }
    commit(next.ledger);
    setNote(null);
    return true;
  };

  const group = ledger.groups.find((item) => item.id === groupId) ?? ledger.groups[0] ?? null;
  const selectedId = group?.id ?? null;
  const people = group?.people ?? [];
  const you = people.find((person) => person.isYou) ?? null;
  const payer = people.find((person) => person.id === payerId) ?? you;
  const rows = selectedId ? balances(ledger, selectedId) : [];
  const owe = selectedId ? whoOwesWhom(ledger, selectedId) : null;
  const summary = selectedId ? groupSummary(ledger, selectedId) : null;
  const expenses = selectedId ? expensesInGroup(ledger, selectedId) : [];

  const createGroup = () => {
    if (!ready || !deviceId) return;
    const id = nid('group');
    const youId = nid('you');
    const next = addGroup(ledger, {
      id,
      name: groupName,
      youId,
      currency,
      ...touch(deviceId),
    });
    if (apply(next)) {
      setGroupId(id);
      setGroupName('');
      setPayerId(youId);
    }
  };

  const createPerson = () => {
    if (!selectedId) return;
    const id = nid('person');
    if (
      apply(
        addPerson(ledger, selectedId, {
          id,
          name: personName,
          ...touch(deviceId),
        }),
      )
    ) {
      setPersonName('');
    }
  };

  const createExpense = () => {
    if (!group || !payer) return;
    const cents = toCents(Number.parseFloat(expenseAmount) || 0);
    const next = addExpense(ledger, {
      id: nid('expense'),
      groupId: group.id,
      description: expenseName,
      amountCents: cents,
      payers: [{ personId: payer.id, cents }],
      split: { method: 'equal', lines: people.map((person) => ({ personId: person.id, value: 0 })) },
      ...touch(deviceId),
    });
    if (apply(next)) {
      setExpenseName('');
      setExpenseAmount('');
    }
  };

  const recordPayment = () => {
    if (!group || !owe || owe.lines.length === 0) return;
    const first = owe.lines[0];
    if (!first) return;
    const cents = toCents(Number.parseFloat(payAmount) || 0) || first.cents;
    apply(
      addSettlement(ledger, {
        id: nid('pay'),
        groupId: group.id,
        fromId: first.fromId,
        toId: first.toId,
        cents,
        ...touch(deviceId),
      }),
    );
    setPayAmount('');
  };

  const removeExpense = (id: string) => {
    const next = deleteExpense(ledger, id, touch(deviceId));
    if (apply(next)) notify?.('Removed', { label: 'Undo', onPress: () => undo() });
  };

  const removePerson = (id: string) => {
    if (!selectedId) return;
    const next = deletePerson(ledger, selectedId, id, touch(deviceId));
    if (apply(next)) notify?.('Removed', { label: 'Undo', onPress: () => undo() });
  };

  const removeGroup = () => {
    if (!selectedId) return;
    const next = deleteGroup(ledger, selectedId, touch(deviceId));
    if (apply(next)) {
      setGroupId(null);
      notify?.('Removed', { label: 'Undo', onPress: () => undo() });
    }
  };

  const shareSummary = async (kind: 'text' | 'image' | 'file') => {
    if (!group || !summary) return;
    if (kind === 'text') {
      const ok = await shareText(summary.text);
      if (!ok) setNote('Couldn’t open the share sheet.');
      return;
    }
    if (kind === 'image') {
      const uri = tempFileUri('png', 'split-summary');
      new File(uri).write(renderSummaryPng(summary));
      const ok = await shareFile(uri, 'image/png');
      if (!ok) setNote('Couldn’t open the share sheet.');
      return;
    }
    const exported = exportGroupFile(ledger, group.id, { deviceId, exportedAt: touch(deviceId).updatedAt });
    if (!exported.ok) {
      setNote(exported.error);
      return;
    }
    const dest = new File(Paths.cache, exported.fileName);
    dest.write(new TextEncoder().encode(exported.text));
    const ok = await shareFile(dest.uri, SPLIT_FILE_MIME);
    if (!ok) setNote('Couldn’t open the share sheet.');
  };

  if (!ready) {
    return <Text style={type.small}>Loading groups…</Text>;
  }

  return (
    <View style={styles.block}>
      <Text style={type.small}>
        Groups stay on this phone. Share a group file to merge it on another phone. Receipt scan stays under By item.
      </Text>
      <Field value={groupName} onChange={setGroupName} placeholder="New group" />
      <Segmented
        options={CURRENCIES.map((code) => ({ id: code, label: code }))}
        value={currency}
        onChange={setCurrency}
      />
      <PrimaryButton label="Create group" onPress={createGroup} />
      <View style={styles.wrap}>
        {ledger.groups.map((item) => (
          <Pressable key={item.id} onPress={() => setGroupId(item.id)} style={[styles.chip, item.id === selectedId && styles.chipOn]}>
            <Text style={[styles.chipText, item.id === selectedId && styles.chipTextOn]}>{item.name}</Text>
          </Pressable>
        ))}
      </View>
      {group && (
        <>
          <Text style={type.label}>{group.name}</Text>
          <Field value={personName} onChange={setPersonName} placeholder="Person’s name" />
          <GhostButton label="Add person" onPress={createPerson} />
          {people.map((person) => (
            <View key={person.id} style={styles.personRow}>
              <Text style={[type.body, styles.flex]}>{person.isYou ? 'You' : person.name}</Text>
              {!person.isYou && (
                <Pressable onPress={() => removePerson(person.id)} accessibilityLabel={`Remove ${person.name}`}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              )}
            </View>
          ))}
          <Text style={type.label}>Who paid</Text>
          <View style={styles.wrap}>
            {people.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => setPayerId(person.id)}
                style={[styles.chip, payer?.id === person.id && styles.chipOn]}
              >
                <Text style={[styles.chipText, payer?.id === person.id && styles.chipTextOn]}>
                  {person.isYou ? 'You' : person.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field value={expenseName} onChange={setExpenseName} placeholder="Expense" />
          <Field value={expenseAmount} onChange={setExpenseAmount} placeholder="Amount" keyboard="decimal-pad" />
          <PrimaryButton label="Add equal expense" onPress={createExpense} />
          {expenses.map((expense) => (
            <Card key={expense.id} style={styles.expense}>
              <View style={styles.personRow}>
                <Text style={[type.body, styles.flex]} numberOfLines={1}>
                  {expense.description}
                </Text>
                <Text style={type.numSmall}>{formatCents(expense.amountCents, expense.currency)}</Text>
                <Pressable onPress={() => removeExpense(expense.id)} accessibilityLabel={`Remove ${expense.description}`}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
            </Card>
          ))}
          <Text style={type.label}>Balances</Text>
          {rows.map((row) => (
            <Text key={`${row.personId}-${row.currency}`} style={type.body}>
              {row.netCents > 0
                ? `${row.isYou ? 'You are' : `${row.name} is`} owed ${formatCents(row.netCents, row.currency)}`
                : row.netCents < 0
                  ? `${row.isYou ? 'You owe' : `${row.name} owes`} ${formatCents(-row.netCents, row.currency)}`
                  : `${row.isYou ? 'You are' : `${row.name} is`} settled`}
            </Text>
          ))}
          <Text style={type.label}>Who owes whom</Text>
          {(owe?.lines.length ? owe.lines : [{ text: 'Everyone is settled up.', fromId: '', toId: '', cents: 0 }]).map(
            (line) => (
              <Text key={line.text} style={type.body}>
                {line.text}
              </Text>
            ),
          )}
          {owe && owe.lines.length > 0 && (
            <>
              <Field value={payAmount} onChange={setPayAmount} placeholder="Payment amount" keyboard="decimal-pad" />
              <GhostButton label="Record that payment" onPress={recordPayment} />
            </>
          )}
          <GhostButton label="Share summary" onPress={() => void shareSummary('text')} />
          <GhostButton label="Share summary image" onPress={() => void shareSummary('image')} />
          <GhostButton label="Share group file" onPress={() => void shareSummary('file')} />
          <GhostButton label="Delete group" onPress={removeGroup} />
        </>
      )}
      {!!note && <Text style={styles.error}>{note}</Text>}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    block: { gap: 10 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    personRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    flex: { flex: 1 },
    expense: { paddingVertical: 8 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: p.secondary,
    },
    chipOn: { backgroundColor: p.primary },
    chipText: { color: p.onSecondary, fontWeight: '600' },
    chipTextOn: { color: p.onPrimary },
    remove: { color: p.textSecondary, fontSize: 16, paddingHorizontal: 6 },
    error: { color: p.destructive, fontSize: 15 },
  });
}
