import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, shareFile, tempFileUri } from '../lib/files';
import { colors, type } from '../theme';

const WIDTHS = [640, 828, 1080, 1170, 1600] as const;
const QUALITIES = [
  { id: '0.5', label: 'Smaller' },
  { id: '0.7', label: 'Balanced' },
  { id: '0.9', label: 'Sharper' },
] as const;

interface Source {
  uri: string;
  width: number;
  height: number;
  bytes: number;
}

interface Result {
  uri: string;
  width: number;
  height: number;
  bytes: number;
}

/** Resize a photo to a width and JPEG quality; before/after sizes shown. */
export function ResizeScreen({
  onBack,
  initialSource,
  notify,
}: {
  onBack: () => void;
  initialSource?: { uri: string; width: number; height: number };
  notify: (msg: string) => void;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [widthIdx, setWidthIdx] = useState(2); // 1080
  const [quality, setQuality] = useState<string>('0.7');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSource = async (uri: string, w: number, h: number) => {
    const info = new File(uri);
    setSource({ uri, width: w, height: h, bytes: info.size ?? 0 });
    setResult(null);
  };

  if (initialSource && !source) {
    void loadSource(initialSource.uri, initialSource.width, initialSource.height);
  }

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is off. Turn it on in Settings to pick a photo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    if (a) await loadSource(a.uri, a.width, a.height);
  };

  const run = async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const targetWidth = Math.min(
        WIDTHS[widthIdx] ?? 1080,
        source.width,
      );
      const out = await manipulateAsync(
        source.uri,
        targetWidth < source.width ? [{ resize: { width: targetWidth } }] : [],
        { format: SaveFormat.JPEG, compress: Number(quality) },
      );
      const target = tempFileUri('jpg', 'resize');
      await new File(out.uri).copy(new File(target));
      const info = new File(target);
      setResult({
        uri: target,
        width: out.width,
        height: out.height,
        bytes: info.size ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resize failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return;
    await MediaLibrary.saveToLibraryAsync(result.uri);
    notify('Saved to Photos');
  };

  return (
    <ToolShell title="Resize photo" onBack={onBack}>
      {source && (
        <Card style={styles.previewCard}>
          <Image source={{ uri: source.uri }} style={styles.preview} />
          <Text style={type.small}>
            {source.width} × {source.height} · {formatBytes(source.bytes)}
          </Text>
        </Card>
      )}
      <PrimaryButton
        label={source ? 'Pick a different photo' : 'Pick a photo'}
        onPress={pick}
      />
      {source && (
        <>
          <Text style={type.label}>Width</Text>
          <View style={styles.chips}>
            {WIDTHS.map((w, i) => {
              const active = i === widthIdx;
              const disabled = w > source.width;
              return (
                <PrimaryChip
                  key={w}
                  label={`${w}`}
                  active={active}
                  disabled={disabled}
                  onPress={() => setWidthIdx(i)}
                />
              );
            })}
          </View>
          <Text style={type.label}>Quality</Text>
          <Segmented
            options={QUALITIES.map((q) => ({ id: q.id as string, label: q.label }))}
            value={quality}
            onChange={setQuality}
          />
          <PrimaryButton
            label={busy ? 'Resizing…' : 'Resize'}
            onPress={run}
            disabled={busy}
            orange
          />
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && source && (
        <Card style={styles.resultCard}>
          <Text style={type.label}>Done</Text>
          <Text style={type.numSmall}>
            {result.width} × {result.height} · {formatBytes(result.bytes)}
          </Text>
          <Text style={type.small}>
            Was {formatBytes(source.bytes)} — saved{' '}
            {formatBytes(Math.max(0, source.bytes - result.bytes))}
          </Text>
          <PrimaryButton label="Save to Photos" onPress={save} />
          <GhostButton
            label="Share image"
            onPress={() => void shareFile(result.uri, 'image/jpeg')}
          />
        </Card>
      )}
    </ToolShell>
  );
}

function PrimaryChip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Text
      onPress={disabled ? undefined : onPress}
      style={[
        styles.chip,
        active && styles.chipActive,
        disabled && { opacity: 0.35 },
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  previewCard: { alignItems: 'center', gap: 8 },
  preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: colors.accent, color: '#FFFFFF' },
  resultCard: { gap: 10 },
  error: { color: colors.danger, fontSize: 15 },
});
