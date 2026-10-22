import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, GhostButton, PrimaryButton, ToolShell } from '../components/ui';
import { shareFile, shareText, tempFileUri } from '../lib/files';
import { renderSummaryPng } from '../lib/splitSummaryPng';
import {
  SPLIT_FILE_MIME,
  SPLIT_LEDGER_STORAGE_KEY,
  applyGroupImport,
  assignDeviceId,
  exportGroupFile,
  groupSummary,
  parseGroupFile,
  parseStoredLedger,
  previewGroupImport,
  serializeLedger,
  type SplitLedger,
} from '../lib/splitwise';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';

function thisPhone(): string {
  return `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Opens when someone taps an .etsplit file. Shows the merge counts, then
 * applies them on this phone. The even-split screen is a different path.
 */
export function SplitImportScreen({
  name,
  text,
  stored,
  onBack,
}: {
  name: string;
  text: string;
  stored: string | null;
  onBack: () => void;
}) {
  const { palette, type, styles } = useThemed(makeStyles);
  const parsed = useMemo(() => parseGroupFile(text), [text]);
  const storedResult = useMemo(() => parseStoredLedger(stored), [stored]);
  const preview = useMemo(() => {
    if (!parsed.ok || !storedResult.ok) return null;
    return previewGroupImport(storedResult.ledger, parsed.file);
  }, [parsed, storedResult]);
  const [applied, setApplied] = useState<SplitLedger | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const summary =
    applied && parsed.ok ? groupSummary(applied, parsed.file.groupId) : null;
  const blocked = !parsed.ok ? parsed.error : !storedResult.ok ? storedResult.error : null;

  const onImport = () => {
    if (!parsed.ok || !storedResult.ok || !preview?.ok || busy) return;
    setBusy(true);
    const result = applyGroupImport(storedResult.ledger, parsed.file);
    if (!result.ok) {
      setNote(result.error);
      setBusy(false);
      return;
    }
    const ledger = assignDeviceId(result.ledger, thisPhone());
    void AsyncStorage.setItem(SPLIT_LEDGER_STORAGE_KEY, serializeLedger(ledger))
      .then(() => {
        setApplied(ledger);
        setNote(`Imported. ${result.preview.summary}`);
        setBusy(false);
      })
      .catch(() => {
        setNote('Couldn’t save the group on this phone.');
        setBusy(false);
      });
  };

  const onShareImage = async () => {
    if (!summary) return;
    const uri = tempFileUri('png', 'split-summary');
    new File(uri).write(renderSummaryPng(summary));
    const ok = await shareFile(uri, 'image/png');
    if (!ok) setNote('Couldn’t open the share sheet.');
  };

  const onShareText = async () => {
    if (!summary) return;
    const ok = await shareText(summary.text);
    if (!ok) setNote('Couldn’t open the share sheet.');
  };

  const onShareFile = async () => {
    if (!applied || !parsed.ok) return;
    const exported = exportGroupFile(applied, parsed.file.groupId, {
      deviceId: applied.deviceId ?? thisPhone(),
      exportedAt: Date.now(),
    });
    if (!exported.ok) {
      setNote(exported.error);
      return;
    }
    const dest = new File(Paths.cache, exported.fileName);
    dest.write(new TextEncoder().encode(exported.text));
    const ok = await shareFile(dest.uri, SPLIT_FILE_MIME);
    if (!ok) setNote('Couldn’t open the share sheet.');
  };

  return (
    <ToolShell title={summary?.title ?? 'Import group'} onBack={onBack}>
      {blocked ? (
        <Card>
          <Text style={type.body}>{blocked}</Text>
        </Card>
      ) : null}

      {!applied && preview?.ok ? (
        <Card>
          <Text style={type.small}>{name}</Text>
          <Text style={[type.h1, styles.count]}>{preview.summary}</Text>
          {preview.changes.slice(0, 6).map((change) => (
            <Text key={`${change.kind}:${change.id}`} style={styles.change}>
              {change.label} · {change.change}
            </Text>
          ))}
          {preview.changes.length > 6 ? (
            <Text style={type.small}>{preview.changes.length - 6} more</Text>
          ) : null}
          <Text style={[type.small, styles.foot]}>Stays on this phone. No account and no iCloud.</Text>
          <PrimaryButton label={busy ? 'Importing…' : 'Import'} onPress={onImport} disabled={busy} />
          <GhostButton label="Not now" onPress={onBack} />
        </Card>
      ) : null}

      {applied && summary ? (
        <Card>
          <Text style={type.label}>Who owes whom</Text>
          {summary.oweLines.map((line) => (
            <Text key={line} style={styles.owe}>
              {line}
            </Text>
          ))}
          <Text style={[type.label, styles.totalsLabel]}>Totals</Text>
          {summary.totals.map((row) => (
            <Text
              key={`${row.currency}:${row.name}:${row.text}`}
              style={[
                styles.total,
                row.tone === 'owed' && { color: palette.success },
                row.tone === 'owes' && { color: palette.destructive },
                row.tone === 'settled' && { color: palette.textSecondary },
              ]}
            >
              {row.text}
            </Text>
          ))}
          <View style={styles.actions}>
            <PrimaryButton label="Share image" onPress={() => void onShareImage()} />
            <GhostButton label="Share text" onPress={() => void onShareText()} />
            <GhostButton label="Share group file" onPress={() => void onShareFile()} />
          </View>
        </Card>
      ) : null}

      {applied && !summary ? (
        <Card>
          <Text style={type.body}>This group was removed on this phone.</Text>
          <GhostButton label="Share group file" onPress={() => void onShareFile()} />
        </Card>
      ) : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </ToolShell>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    count: { marginTop: 8, marginBottom: 12 },
    change: { fontSize: 16, color: p.textPrimary, marginBottom: 6 },
    foot: { marginTop: 8, marginBottom: 16 },
    owe: { fontSize: 17, fontWeight: '700', color: p.textPrimary, marginTop: 8 },
    totalsLabel: { marginTop: 18 },
    total: { fontSize: 16, fontWeight: '700', marginTop: 8 },
    actions: { marginTop: 18, gap: 8 },
    note: { color: p.textSecondary, fontSize: 14, marginTop: 12 },
  });
}
