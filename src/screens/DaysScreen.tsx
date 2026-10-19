import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Segmented, ToolShell } from '../components/ui';
import { breakdownYMD, daysBetween, formatBreakdown } from '../lib/dates';
import { type } from '../theme';

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
export function DaysScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('between');
  const today = useMemo(() => startOfDay(new Date()), []);
  const [from, setFrom] = useState<Date>(today);
  const [to, setTo] = useState<Date>(() => plusDays(today, 30));
  const [target, setTarget] = useState<Date>(() => plusDays(today, 100));
  const [birth, setBirth] = useState<Date>(() => plusDays(today, -365 * 25));
  const [openPicker, setOpenPicker] = useState<
    'from' | 'to' | 'target' | 'birth' | null
  >(null);

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
        <DateTimePicker
          value={value}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_e, d) => {
            if (d) set(startOfDay(d));
            if (Platform.OS !== 'ios') setOpenPicker(null);
          }}
        />
      )}
    </View>
  );

  const between = daysBetween(from, to);
  const until = daysBetween(today, target);
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
              {formatBreakdown(breakdownYMD(from, to))}
            </Text>
          </Card>
        </>
      )}

      {mode === 'until' && (
        <>
          {dateField('Date', target, 'target', setTarget)}
          <Card style={styles.result}>
            <Text style={type.numBig}>{Math.abs(until)}</Text>
            <Text style={type.small}>
              {until > 0 ? 'days to go' : until < 0 ? 'days ago' : 'today'}
            </Text>
            <Text style={[type.body, styles.breakdown]}>
              {formatBreakdown(breakdownYMD(today, target))}
            </Text>
          </Card>
        </>
      )}

      {mode === 'age' && (
        <>
          {dateField('Born', birth, 'birth', setBirth)}
          <Card style={styles.result}>
            <Text style={type.numBig}>{age}</Text>
            <Text style={type.small}>days old</Text>
            <Text style={[type.body, styles.breakdown]}>
              {formatBreakdown(breakdownYMD(birth, today))}
            </Text>
          </Card>
        </>
      )}
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  dateCard: { marginTop: 6, paddingVertical: 14 },
  result: { alignItems: 'center', gap: 2, paddingVertical: 22 },
  breakdown: { marginTop: 6 },
});
