import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { shareText } from '../lib/files';
import { evenBillShareText, formatMoney, itemBillShareText, splitBill, toCents } from '../lib/money';
import { linesFromBoxes, parseReceipt, splitByItems, type ReceiptItem } from '../lib/receipt';
import { recognizeText } from '../store/sharedVault';
import { colors, type } from '../theme';

const PERSON = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const TIP_PRESETS = [0, 10, 15, 18, 20, 25];

/**
 * Split bill: total, tax, tip (preset or custom), people. All math in
 * integer cents — the per-person shares always sum to the grand total.
 */
export function SplitScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'even' | 'items'>('even');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [assign, setAssign] = useState<number[][]>([]);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [totalStr, setTotalStr] = useState('');
  const [taxStr, setTaxStr] = useState('');
  const [tipPct, setTipPct] = useState(18);
  const [customTip, setCustomTip] = useState('');
  const [people, setPeople] = useState(2);

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

  const scanReceipt = async (source: 'camera' | 'library') => {
    setScanNote(null);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setScanNote(source === 'camera' ? 'Camera access is off in Settings.' : 'Photo access is off in Settings.');
      return;
    }
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    setScanning(true);
    try {
      const boxes = await recognizeText(res.assets[0].uri);
      if (!boxes) {
        setScanNote('Receipt reading needs the installed Everytool app.');
        return;
      }
      const parsed = parseReceipt(linesFromBoxes(boxes));
      if (parsed.items.length === 0) {
        setScanNote('No prices found. Try a flatter, closer photo — or add items by hand below.');
        return;
      }
      setItems(parsed.items);
      setAssign(parsed.items.map(() => []));
      if (parsed.taxCents != null) setTaxStr((parsed.taxCents / 100).toFixed(2));
      if (parsed.tipCents != null && parsed.tipCents > 0) {
        const sum = parsed.items.reduce((a, b) => a + b.cents, 0);
        if (sum > 0) setCustomTip(((parsed.tipCents / sum) * 100).toFixed(1));
      }
      const itemsSum = parsed.items.reduce((a, b) => a + b.cents, 0);
      setScanNote(
        parsed.totalCents != null &&
          Math.abs(itemsSum + (parsed.taxCents ?? 0) + (parsed.tipCents ?? 0) - parsed.totalCents) > 1
          ? `Read ${parsed.items.length} items. The receipt total is ${formatMoney(parsed.totalCents)} — check the items match.`
          : `Read ${parsed.items.length} items — on this phone, nothing uploaded.`,
      );
    } catch {
      setScanNote('Couldn’t read that receipt.');
    } finally {
      setScanning(false);
    }
  };

  const toggle = (k: number, p: number) =>
    setAssign((all) => {
      const next = all.map((a) => [...a]);
      while (next.length <= k) next.push([]);
      const cur = next[k]!;
      next[k] = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      return next;
    });

  const removeItem = (k: number) => {
    setItems((all) => all.filter((_, i) => i !== k));
    setAssign((all) => all.filter((_, i) => i !== k));
  };

  const addItem = () => {
    const cents = toCents(Number.parseFloat(newPrice) || 0);
    if (!newName.trim() || cents <= 0) return;
    setItems((all) => [...all, { name: newName.trim(), cents }]);
    setAssign((all) => [...all, []]);
    setNewName('');
    setNewPrice('');
  };

  return (
    <ToolShell title="Split bill" onBack={onBack}>
      <Segmented
        options={[
          { id: 'even', label: 'Split evenly' },
          { id: 'items', label: 'By item' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'items' && (
        <>
          <View style={styles.row}>
            <View style={styles.half}>
              <PrimaryButton
                label={scanning ? 'Reading…' : 'Scan receipt'}
                onPress={() => void scanReceipt('camera')}
                disabled={scanning}
              />
            </View>
            <View style={styles.half}>
              <GhostButton label="From a photo" onPress={() => void scanReceipt('library')} />
            </View>
          </View>
          {!!scanNote && <Text style={type.small}>{scanNote}</Text>}
          {items.length > 0 && (
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
                <Pressable onPress={() => removeItem(k)} hitSlop={8} accessibilityLabel={`Remove ${item.name}`}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
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
            </Card>
          ))}
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
        onChange={setTotalStr}
        placeholder="Bill total $"
        keyboard="decimal-pad"
      />
      )}
      <Field
        value={taxStr}
        onChange={setTaxStr}
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
          setTipPct(Number(v));
          setCustomTip('');
        }}
      />
      <Field
        value={customTip}
        onChange={setCustomTip}
        placeholder="Custom tip % (optional)"
        keyboard="decimal-pad"
      />

      <Text style={type.label}>People</Text>
      <View style={styles.stepper}>
        <Text
          style={styles.stepButton}
          onPress={() => setPeople((p) => Math.max(1, p - 1))}
        >
          −
        </Text>
        <Text style={type.num}>{people}</Text>
        <Text
          style={styles.stepButton}
          onPress={() => setPeople((p) => Math.min(99, p + 1))}
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
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stepButton: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  result: { gap: 8 },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  half: { flex: 1 },
  flex: { flex: 1 },
  flex2: { flex: 2 },
  itemCard: { gap: 8, paddingVertical: 12 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  remove: { fontSize: 15, color: colors.faint, paddingHorizontal: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    minWidth: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.muted },
  chipTextOn: { color: '#FFFFFF' },
});
