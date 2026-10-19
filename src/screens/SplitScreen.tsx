import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Field, Segmented, ToolShell } from '../components/ui';
import { formatMoney, splitBill } from '../lib/money';
import { colors, type } from '../theme';

const TIP_PRESETS = [0, 10, 15, 18, 20, 25];

/**
 * Split bill: total, tax, tip (preset or custom), people. All math in
 * integer cents — the per-person shares always sum to the grand total.
 */
export function SplitScreen({ onBack }: { onBack: () => void }) {
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

  return (
    <ToolShell title="Split bill" onBack={onBack}>
      <Field
        value={totalStr}
        onChange={setTotalStr}
        placeholder="Bill total $"
        keyboard="decimal-pad"
      />
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
      </Card>
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
});
