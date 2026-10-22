import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { shareText } from '../lib/files';
import { evenBillShareText, formatMoney, itemBillShareText, splitBill, toCents } from '../lib/money';
import {
  mergeParsedReceipts,
  parseReceiptBoxes,
  splitByItems,
  type ParsedReceipt,
  type ReceiptItem,
} from '../lib/receipt';
import { liveTextSupported, recognizeText, scanDocumentPages, scanLiveText } from '../store/sharedVault';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';
import { SplitGroups, type HistoryNav } from './SplitGroups';

const PERSON = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const TIP_PRESETS = [0, 10, 15, 18, 20, 25];

/**
 * Split bill: total, tax, tip (preset or custom), people. All math in
 * integer cents — the per-person shares always sum to the grand total.
 */
type Bill = {
  items: ReceiptItem[];
  assign: number[][];
  totalStr: string;
  taxStr: string;
  tipPct: number;
  customTip: string;
  people: number;
};

const emptyBill: Bill = {
  items: [],
  assign: [],
  totalStr: '',
  taxStr: '',
  tipPct: 18,
  customTip: '',
  people: 2,
};

export function SplitScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify?: (msg: string, action?: { label: string; onPress: () => void }) => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const [mode, setMode] = useState<'even' | 'items' | 'groups'>('even');
  const [groupNav, setGroupNav] = useState<HistoryNav | null>(null);
  const onGroupNav = useCallback((nav: HistoryNav) => {
    setGroupNav(nav);
  }, []);
  const bill = useUndoHistory<Bill>(emptyBill, { shake: true });
  const { items, assign, totalStr, taxStr, tipPct, customTip, people } = bill.present;
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [liveText] = useState(() => liveTextSupported());

  const isCustom = customTip.trim().length > 0;
  const effectiveTip = isCustom ? Number.parseFloat(customTip) || 0 : tipPct;

  const result = useMemo(
    () =>
      splitBill(
        Number.parseFloat(totalStr) || 0,
        Number.parseFloat(taxStr) || 0,
        effectiveTip,
        people,
      ),
    [totalStr, taxStr, effectiveTip, people],
  );

  const distinctShares = [...new Set(result.sharesCents)];

  const itemSplit = useMemo(
    () =>
      splitByItems(
        items,
        assign,
        people,
        toCents(Number.parseFloat(taxStr) || 0),
        { percent: effectiveTip },
      ),
    [items, assign, people, taxStr, effectiveTip],
  );

  const applyParsed = (parsed: ParsedReceipt) => {
    if (parsed.items.length === 0) {
      setScanNote('No prices found. Try a flatter, closer photo — or add items by hand below.');
      return;
    }
    bill.commit((current) => {
      const next: Bill = {
        ...current,
        items: parsed.items,
        assign: parsed.items.map(() => []),
      };
      if (parsed.taxCents != null) next.taxStr = (parsed.taxCents / 100).toFixed(2);
      if (parsed.tipCents != null && parsed.tipCents > 0) {
        const sum = parsed.items.reduce((a, b) => a + b.cents, 0);
        if (sum > 0) next.customTip = ((parsed.tipCents / sum) * 100).toFixed(1);
      }
      return next;
    });
    setReviewing(true);
    setEditing(null);
    const itemsSum = parsed.items.reduce((a, b) => a + b.cents, 0);
    setScanNote(
      parsed.totalCents != null &&
        Math.abs(itemsSum + (parsed.taxCents ?? 0) + (parsed.tipCents ?? 0) - parsed.totalCents) > 1
        ? `Read ${parsed.items.length} items. The receipt total is ${formatMoney(parsed.totalCents)} — check the items match.`
        : `Read ${parsed.items.length} items — on this phone, nothing uploaded.`,
    );
  };

  const readUris = async (uris: string[]) => {
    setScanning(true);
    try {
      const pages: ParsedReceipt[] = [];
      for (const uri of uris) {
        const boxes = await recognizeText(uri);
        if (!boxes) {
          setScanNote('Receipt reading needs the installed Everytool app.');
          return;
        }
        pages.push(parseReceiptBoxes(boxes));
      }
      applyParsed(mergeParsedReceipts(pages));
    } catch {
      setScanNote('Couldn’t read that receipt.');
    } finally {
      setScanning(false);
    }
  };

  const scanReceipt = async () => {
    setScanNote(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setScanNote('Camera access is off in Settings.');
      return;
    }
    try {
      const pages = await scanDocumentPages();
      if (pages == null) {
        setScanNote('This build can’t open the receipt scanner. Update Everytool and try again.');
        return;
      }
      if (pages.length === 0) return;
      await readUris(pages);
    } catch {
      setScanNote('Couldn’t open the receipt scanner.');
    }
  };

  const scanFromPhoto = async () => {
    setScanNote(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setScanNote('Photo access is off in Settings.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    await readUris([res.assets[0].uri]);
  };

  const scanLive = async () => {
    setScanNote(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setScanNote('Camera access is off in Settings.');
      return;
    }
    try {
      const boxes = await scanLiveText();
      if (boxes == null) {
        setScanNote('This build can’t open live text. Update Everytool and try again.');
        return;
      }
      if (boxes.length === 0) return;
      applyParsed(parseReceiptBoxes(boxes));
    } catch {
      setScanNote('Live text isn’t available on this iPhone.');
    }
  };

  const toggle = (k: number, p: number) =>
    bill.commit((current) => {
      const next = current.assign.map((a) => [...a]);
      while (next.length <= k) next.push([]);
      const cur = next[k]!;
      next[k] = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      return { ...current, assign: next };
    });

  const removeItem = (k: number) => {
    bill.commit((current) => ({
      ...current,
      items: current.items.filter((_, i) => i !== k),
      assign: current.assign.filter((_, i) => i !== k),
    }));
    notify?.('Removed', { label: 'Undo', onPress: () => bill.undo() });
  };

  const addItem = () => {
    const cents = toCents(Number.parseFloat(newPrice) || 0);
    if (!newName.trim() || cents <= 0) return;
    const name = newName.trim();
    bill.commit((current) => ({
      ...current,
      items: [...current.items, { name, cents }],
      assign: [...current.assign, []],
    }));
    setNewName('');
    setNewPrice('');
  };

  return (
    <ToolShell
      title="Split bill"
      onBack={onBack}
      undo={
        mode === 'groups'
          ? {
              canUndo: groupNav?.canUndo ?? false,
              canRedo: groupNav?.canRedo ?? false,
              onUndo: () => groupNav?.undo(),
              onRedo: () => groupNav?.redo(),
            }
          : {
              canUndo: bill.canUndo,
              canRedo: bill.canRedo,
              onUndo: () => bill.undo(),
              onRedo: () => bill.redo(),
            }
      }
    >
      <Segmented
        options={[
          { id: 'even', label: 'Split evenly' },
          { id: 'items', label: 'By item' },
          { id: 'groups', label: 'Groups' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'groups' && <SplitGroups notify={notify} onHistory={onGroupNav} />}
      {mode === 'items' && (
        <>
          <View style={styles.row}>
            <View style={styles.half}>
              <PrimaryButton
                label={scanning ? 'Reading…' : 'Scan receipt'}
                onPress={() => void scanReceipt()}
                disabled={scanning}
              />
            </View>
            <View style={styles.half}>
              <GhostButton label="From a photo" onPress={() => void scanFromPhoto()} />
            </View>
          </View>
          {liveText && <GhostButton label="Live text" onPress={() => void scanLive()} />}
          {!!scanNote && <Text style={type.small}>{scanNote}</Text>}
          {reviewing && items.length > 0 && (
            <Text style={type.small}>Check the names and prices, then assign them.</Text>
          )}
          {items.length > 0 && !reviewing && (
            <Text style={type.small}>
              Tap the people who shared each item. No one tapped = everyone shares it.
            </Text>
          )}
          {items.map((item, k) => (
            <Card key={`${item.name}-${k}`} style={styles.itemCard}>
              <View style={styles.itemTop}>
                <Text style={[type.body, styles.flex]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={type.numSmall}>{formatMoney(item.cents)}</Text>
                {reviewing && (
                  <Pressable
                    onPress={() => {
                      setEditing(k);
                      setDraftName(item.name);
                      setDraftPrice((item.cents / 100).toFixed(2));
                    }}
                    hitSlop={8}
                    accessibilityLabel={`Edit ${item.name}`}
                  >
                    <Text style={styles.edit}>Edit</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => removeItem(k)} hitSlop={8} accessibilityLabel={`Remove ${item.name}`}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
              {editing === k && (
                <View style={styles.row}>
                  <View style={styles.flex2}>
                    <Field value={draftName} onChange={setDraftName} placeholder="Item" />
                  </View>
                  <View style={styles.flex}>
                    <Field value={draftPrice} onChange={setDraftPrice} placeholder="$" keyboard="decimal-pad" />
                  </View>
                  <Pressable
                    onPress={() => {
                      const cents = toCents(Number.parseFloat(draftPrice) || 0);
                      const name = draftName.trim();
                      if (name && cents > 0) {
                        bill.commit((current) => ({
                          ...current,
                          items: current.items.map((it, i) => (i === k ? { name, cents } : it)),
                        }));
                      }
                      setEditing(null);
                    }}
                    hitSlop={8}
                    accessibilityLabel={`Save ${item.name}`}
                  >
                    <Text style={styles.edit}>Done</Text>
                  </Pressable>
                </View>
              )}
              {!reviewing && (
              <View style={styles.chips}>
                {Array.from({ length: people }, (_, p) => {
                  const on = (assign[k] ?? []).includes(p);
                  return (
                    <Pressable
                      key={p}
                      onPress={() => toggle(k, p)}
                      accessibilityLabel={`Person ${PERSON[p] ?? p + 1} shared ${item.name}`}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>
                        {PERSON[p] ?? p + 1}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              )}
            </Card>
          ))}
          {reviewing && items.length > 0 && (
            <PrimaryButton
              label="Assign these"
              onPress={() => {
                setReviewing(false);
                setEditing(null);
              }}
            />
          )}
          <View style={styles.row}>
            <View style={styles.flex2}>
              <Field value={newName} onChange={setNewName} placeholder="Item" testID="split.itemName" />
            </View>
            <View style={styles.flex}>
              <Field value={newPrice} onChange={setNewPrice} placeholder="$" keyboard="decimal-pad" testID="split.itemPrice" />
            </View>
          </View>
          <GhostButton label="Add item" onPress={addItem} />
        </>
      )}
      {mode === 'even' && (
      <Field
        value={totalStr}
        onChange={(value) => bill.commit((current) => ({ ...current, totalStr: value }), true)}
        placeholder="Bill total $"
        keyboard="decimal-pad"
      />
      )}
      {mode !== 'groups' && (
      <>
      <Field
        value={taxStr}
        onChange={(value) => bill.commit((current) => ({ ...current, taxStr: value }), true)}
        placeholder="Tax $ (optional)"
        keyboard="decimal-pad"
      />

      <Text style={type.label}>Tip</Text>
      <Segmented
        options={TIP_PRESETS.map((p) => ({
          id: String(p),
          label: `${p}%`,
        }))}
        value={String(tipPct)}
        onChange={(v) => {
          bill.commit((current) => ({ ...current, tipPct: Number(v), customTip: '' }));
        }}
      />
      <Field
        value={customTip}
        onChange={(value) => bill.commit((current) => ({ ...current, customTip: value }), true)}
        placeholder="Custom tip % (optional)"
        keyboard="decimal-pad"
      />

      <Text style={type.label}>People</Text>
      <View style={styles.stepper}>
        <Text
          style={styles.stepButton}
          onPress={() => bill.commit((current) => ({ ...current, people: Math.max(1, current.people - 1) }))}
        >
          −
        </Text>
        <Text style={type.num}>{people}</Text>
        <Text
          style={styles.stepButton}
          onPress={() => bill.commit((current) => ({ ...current, people: Math.min(99, current.people + 1) }))}
        >
          +
        </Text>
      </View>

      {mode === 'items' && items.length > 0 && (
        <Card style={styles.result}>
          <View style={styles.resultRow}>
            <Text style={type.small}>Items</Text>
            <Text style={type.numSmall}>{formatMoney(itemSplit.itemsCents)}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={type.small}>Tax + tip</Text>
            <Text style={type.numSmall}>{formatMoney(itemSplit.taxCents + itemSplit.tipCents)}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={type.small}>Total</Text>
            <Text style={type.numSmall}>{formatMoney(itemSplit.grandCents)}</Text>
          </View>
          <View style={styles.divider} />
          {itemSplit.perPerson.map((c, p) => (
            <View key={p} style={styles.resultRow}>
              <Text style={type.body}>Person {PERSON[p] ?? p + 1} pays</Text>
              <Text style={type.num}>{formatMoney(c)}</Text>
            </View>
          ))}
          <GhostButton label="Share" onPress={() => void shareText(itemBillShareText(itemSplit.perPerson))} />
        </Card>
      )}

      {mode === 'even' && (
      <Card style={styles.result}>
        <View style={styles.resultRow}>
          <Text style={type.small}>Tip</Text>
          <Text style={type.numSmall}>{formatMoney(result.tipCents)}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={type.small}>Total with tax & tip</Text>
          <Text style={type.numSmall}>{formatMoney(result.grandCents)}</Text>
        </View>
        <View style={styles.divider} />
        {distinctShares.length <= 2 ? (
          distinctShares.map((share, i) => (
            <View key={share} style={styles.resultRow}>
              <Text style={type.body}>
                {i === 0
                  ? distinctShares.length === 1
                    ? `Each of ${people}`
                    : `${result.sharesCents.filter((s) => s === share).length} people pay`
                  : `${result.sharesCents.filter((s) => s === share).length} people pay`}
              </Text>
              <Text style={type.num}>{formatMoney(share)}</Text>
            </View>
          ))
        ) : (
          <Text style={type.body}>{formatMoney(result.sharesCents[0] ?? 0)} each</Text>
        )}
        <GhostButton
          label="Share"
          onPress={() =>
            void shareText(
              evenBillShareText({
                people,
                tipCents: result.tipCents,
                grandCents: result.grandCents,
                sharesCents: result.sharesCents,
              }),
            )
          }
        />
      </Card>
      )}
      </>
      )}
    </ToolShell>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: p.surface,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    stepButton: {
      fontSize: 30,
      fontWeight: '700',
      color: p.primary,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    result: { gap: 8 },
    resultRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    divider: { height: 1, backgroundColor: p.separator, marginVertical: 4 },
    row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    half: { flex: 1 },
    flex: { flex: 1 },
    flex2: { flex: 2 },
    itemCard: { gap: 8, paddingVertical: 12 },
    itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    remove: { fontSize: 15, color: p.textSecondary, paddingHorizontal: 4 },
    edit: { fontSize: 15, fontWeight: '700', color: p.primary, paddingHorizontal: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      minWidth: 36,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 18,
      backgroundColor: p.background,
      alignItems: 'center',
    },
    chipOn: { backgroundColor: p.primary },
    chipText: { fontSize: 15, fontWeight: '700', color: p.textSecondary },
    chipTextOn: { color: p.onPrimary },
  });
}
