import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, useColorScheme, View } from 'react-native';

import { Card, Field, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { daysLeft, describeDaysLeft, sortCountdowns } from '../lib/countdowns';
import { countedBreakdown, countedDays, daysBetween, formatBreakdown } from '../lib/dates';
import { useStore } from '../store/AppStore';
import { colors, type } from '../theme';

type Mode = 'between' | 'until' | 'age';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function plusDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Days counter: between two dates, until a date, or age in days. All of
 * it runs on the clamped calendar math in lib/dates (month-end safe).
 */
export function DaysScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify?: (msg: string) => void;
}) {
  const { state, addCountdown, deleteCountdown } = useStore();
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<Mode>(state.countdowns.length > 0 ? 'until' : 'between');
  const today = useMemo(() => startOfDay(new Date()), []);
  const [from, setFrom] = useState<Date>(today);
  const [to, setTo] = useState<Date>(() => plusDays(today, 30));
  const [target, setTarget] = useState<Date>(() => plusDays(today, 100));
  const [birth, setBirth] = useState<Date>(() => plusDays(today, -365 * 25));
  const [includeBetween, setIncludeBetween] = useState(false);
  const [includeUntil, setIncludeUntil] = useState(false);
  const [openPicker, setOpenPicker] = useState<
    'from' | 'to' | 'target' | 'birth' | null
  >(null);
  // The screen chrome is light gray. An inline UIDatePicker with an
  // unspecified style follows a dark trait and paints the month title,
  // weekday headers, and day numbers white. Pin the picker to the real
  // scheme and sit it on a card of that same scheme.
  const scheme = useColorScheme();
  const pickerVariant = scheme === 'dark' ? 'dark' : 'light';

  const dateField = (
    label: string,
    value: Date,
    key: 'from' | 'to' | 'target' | 'birth',
    set: (d: Date) => void,
  ) => (
    <View>
      <Text style={type.label}>{label}</Text>
      <Pressable onPress={() => setOpenPicker(openPicker === key ? null : key)}>
        <Card style={styles.dateCard}>
          <Text style={type.body}>{fmt(value)}</Text>
        </Card>
      </Pressable>
      {openPicker === key && (
        <View style={[styles.pickerCard, pickerVariant === 'dark' && styles.pickerCardDark]}>
          <DateTimePicker
            value={value}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            themeVariant={pickerVariant}
            accentColor={colors.accent}
            style={styles.picker}
            onChange={(_e, d) => {
              if (d) set(startOfDay(d));
              if (Platform.OS !== 'ios') setOpenPicker(null);
            }}
          />
        </View>
      )}
    </View>
  );

  const between = countedDays(from, to, includeBetween);
  const untilRaw = daysBetween(today, target);
  const until = countedDays(today, target, includeUntil);
  const age = daysBetween(birth, today);

  return (
    <ToolShell title="Days counter" onBack={onBack}>
      <Segmented
        options={[
          { id: 'between', label: 'Between' },
          { id: 'until', label: 'Until' },
          { id: 'age', label: 'Age' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'between' && (
        <>
          {dateField('From', from, 'from', setFrom)}
          {dateField('To', to, 'to', setTo)}
          <Card style={styles.result}>
            <Text style={type.numBig}>{Math.abs(between)}</Text>
            <Text style={type.small}>days</Text>
            <Text style={[type.body, styles.breakdown]}>
              {formatBreakdown(countedBreakdown(from, to, includeBetween))}
            </Text>
            <IncludeToday value={includeBetween} onChange={setIncludeBetween} />
          </Card>
        </>
      )}

      {mode === 'until' && (
        <>
          {dateField('Date', target, 'target', setTarget)}
          <Card style={styles.result}>
            <Text style={type.numBig}>{Math.abs(until)}</Text>
            <Text style={type.small}>
              {untilRaw === 0 ? 'today' : untilRaw > 0 ? 'days to go' : 'days ago'}
            </Text>
            <Text style={[type.body, styles.breakdown]}>
              {formatBreakdown(countedBreakdown(today, target, includeUntil))}
            </Text>
            <IncludeToday value={includeUntil} onChange={setIncludeUntil} />
          </Card>
          <Field
            value={title}
            onChange={setTitle}
            placeholder="Name it (e.g. Trip to Lisbon)"
            testID="days.title"
          />
          <PrimaryButton
            label="Save as countdown"
            onPress={() => {
              addCountdown(title, target, includeUntil);
              setTitle('');
              notify?.('Countdown saved — add the Countdown widget to see it at a glance');
            }}
            testID="days.save"
          />
          {state.countdowns.length > 0 && (
            <>
              <Text style={type.label}>Your countdowns</Text>
              {sortCountdowns(state.countdowns, today).map((c) => {
                const raw = daysBetween(today, new Date(c.date));
                const n = daysLeft(c, today);
                return (
                  <Card key={c.id} style={styles.cdRow}>
                    <View style={styles.cdMain}>
                      <Text style={type.body} numberOfLines={1}>
                        {c.title}
                      </Text>
                      <Text style={type.small}>
                        {fmt(new Date(c.date))} · {describeDaysLeft(raw, c.includeToday === true)}
                      </Text>
                    </View>
                    <Text style={[type.num, n < 0 && { color: colors.faint }]}>{Math.abs(n)}</Text>
                    <Pressable
                      accessibilityLabel={`Delete ${c.title}`}
                      onPress={() => deleteCountdown(c.id)}
                      hitSlop={8}
                    >
                      <Text style={styles.cdDelete}>✕</Text>
                    </Pressable>
                  </Card>
                );
              })}
              <Text style={type.small}>
                Home or Lock Screen: touch and hold, tap Edit → Add Widget, choose
                Everytool → Countdown. It shows your next countdown.
              </Text>
            </>
          )}
        </>
      )}

      {mode === 'age' && (
        <>
          {dateField('Born', birth, 'birth', setBirth)}
          <Card style={styles.result}>
            <Text style={type.numBig}>{age}</Text>
            <Text style={type.small}>days old</Text>
            <Text style={[type.body, styles.breakdown]}>
              {formatBreakdown(countedBreakdown(birth, today))}
            </Text>
          </Card>
        </>
      )}
    </ToolShell>
  );
}

function IncludeToday({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.includeRow}>
      <Text style={type.body}>Include today</Text>
      <Switch
        accessibilityLabel="Include today"
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.accent }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dateCard: { marginTop: 6, paddingVertical: 14 },
  pickerCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    overflow: 'hidden',
  },
  pickerCardDark: { backgroundColor: '#1C1C1E' },
  picker: { width: '100%' },
  result: { alignItems: 'center', gap: 2, paddingVertical: 22 },
  breakdown: { marginTop: 6 },
  includeRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cdRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  cdMain: { flex: 1, gap: 2 },
  cdDelete: { fontSize: 16, color: colors.faint, paddingHorizontal: 4 },
});
