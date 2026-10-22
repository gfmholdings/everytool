import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, measureImage, saveToPhotos, shareFile, tempFileUri } from '../lib/files';
import {
  estimateOutputBytes,
  fitToMaxBytes,
  fitToMaxBytesAsync,
  fitWarning,
  outputSize,
  parseSizeTarget,
  PASSPORT_LIMITS,
  QUALITY_CEILING,
  SIZE_CHIPS,
  type FitStep,
  type ResizeFormat,
  type SizeUnit,
} from '../lib/resizePlan';
import { reencodeImage } from '../store/sharedVault';
import { colors, type } from '../theme';

const WIDTHS = [640, 828, 1080, 1170, 1280, 1600] as const;

/** One-tap sizes for where the photo is going. */
const PRESETS = [
  { label: 'Email', width: 1280, quality: '0.7', note: 'small attachment, still sharp' },
  { label: 'WhatsApp', width: 1600, quality: '0.7', note: 'matches what chat apps keep' },
  { label: 'Instagram', width: 1080, quality: '0.9', note: '1080 px wide, high quality' },
  { label: 'Tiny', width: 640, quality: '0.5', note: 'smallest, for forms with size limits' },
] as const;
const QUALITIES = [
  { id: '0.5', label: 'Smaller' },
  { id: '0.7', label: 'Balanced' },
  { id: '0.9', label: 'Sharper' },
] as const;

const MIME: Record<ResizeFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

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
  format: ResizeFormat;
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
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const [quality, setQuality] = useState<string>('0.7');
  const [compressOnly, setCompressOnly] = useState(false);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [customUnit, setCustomUnit] = useState<SizeUnit>('KB');
  const [format, setFormat] = useState<ResizeFormat>('jpeg');
  const [stripMetadata, setStripMetadata] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSource = async (uri: string, w: number, h: number) => {
    // Shared files arrive without a size; measure so the width chips and
    // the resize target are right.
    const size = w > 0 && h > 0 ? { width: w, height: h } : await measureImage(uri);
    const info = new File(uri);
    setSource({ uri, width: size.width, height: size.height, bytes: info.size ?? 0 });
    // Default to the largest preset that actually shrinks the photo.
    const fit = WIDTHS.reduce((best, wd, i) => (wd < size.width ? i : best), 0);
    setWidthIdx(Math.min(2, fit));
    setWidthOverride(null);
    setResult(null);
  };

  useEffect(() => {
    if (!initialSource) return;
    let liveFlag = true;
    const t = setTimeout(() => {
      if (liveFlag) void loadSource(initialSource.uri, initialSource.width, initialSource.height);
    }, 0);
    return () => {
      liveFlag = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource?.uri]);

  const maxBytes = (): number | null => {
    if (sizeId == null) return null;
    if (sizeId === 'custom') return parseSizeTarget(customAmount, customUnit);
    const chip = SIZE_CHIPS.find((c) => c.id === sizeId);
    if (chip) return chip.bytes;
    return PASSPORT_LIMITS.find((p) => p.id === sizeId)?.bytes ?? null;
  };

  const chosenWidth = source
    ? compressOnly
      ? source.width
      : Math.min(widthOverride ?? WIDTHS[widthIdx] ?? 1080, source.width)
    : 0;

  const cap = maxBytes();

  const live = useMemo(() => {
    if (!source || cap == null) return null;
    return fitToMaxBytes(
      {
        sourceWidth: source.width,
        sourceHeight: source.height,
        targetWidth: compressOnly ? null : chosenWidth,
        maxBytes: cap,
        format,
        allowDownscale: !compressOnly,
        preferredQuality: QUALITY_CEILING,
      },
      (step) => estimateOutputBytes(step.width, step.height, step.quality, format),
    );
  }, [source, cap, chosenWidth, compressOnly, format]);

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

  const encodeAt = async (dest: string, step: FitStep, as: ResizeFormat): Promise<number | null> => {
    if (!source) return null;
    const nativeBytes = reencodeImage(source.uri, dest, as, step.quality, step.width, stripMetadata);
    if (nativeBytes != null) return nativeBytes;
    if (as === 'heic') return null;
    const out = await manipulateAsync(
      source.uri,
      step.width < source.width ? [{ resize: { width: step.width, height: step.height } }] : [],
      {
        format: as === 'png' ? SaveFormat.PNG : SaveFormat.JPEG,
        compress: as === 'png' ? 1 : step.quality,
      },
    );
    await new File(out.uri).copy(new File(dest));
    return new File(dest).size ?? 0;
  };

  const run = async () => {
    if (!source) return;
    if (sizeId === 'custom' && cap == null) {
      setError('Enter a max size in KB or MB.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ext = format === 'jpeg' ? 'jpg' : format;
      let usedFormat = format;
      let step: FitStep;
      let note: string | null = null;
      if (cap == null) {
        const size = outputSize(source.width, source.height, chosenWidth);
        step = { ...size, quality: format === 'png' ? 1 : Number(quality) };
      } else {
        const plan = await fitToMaxBytesAsync(
          {
            sourceWidth: source.width,
            sourceHeight: source.height,
            targetWidth: compressOnly ? null : chosenWidth,
            maxBytes: cap,
            format,
            allowDownscale: !compressOnly,
            preferredQuality: QUALITY_CEILING,
          },
          async (probe) => {
            const uri = tempFileUri(ext, 'resize-probe');
            try {
              const bytes = await encodeAt(uri, probe, format);
              return bytes ?? Number.MAX_SAFE_INTEGER;
            } finally {
              try {
                new File(uri).delete();
              } catch {
                // probe cleanup is best effort
              }
            }
          },
        );
        step = { width: plan.width, height: plan.height, quality: plan.quality };
        note = fitWarning(plan, chosenWidth, cap);
      }
      const target = tempFileUri(ext, 'resize');
      let bytes = await encodeAt(target, step, usedFormat);
      if (bytes == null && usedFormat === 'heic') {
        usedFormat = 'jpeg';
        const jpegTarget = tempFileUri('jpg', 'resize');
        bytes = await encodeAt(jpegTarget, step, 'jpeg');
        if (bytes == null) throw new Error('Couldn’t encode that photo.');
        setResult({ uri: jpegTarget, width: step.width, height: step.height, bytes, format: 'jpeg' });
        setNotice(
          note
            ? `${note} HEIC isn’t available here, so this one was saved as JPEG.`
            : 'HEIC isn’t available here, so this one was saved as JPEG.',
        );
      } else {
        if (bytes == null) throw new Error('Couldn’t encode that photo.');
        setResult({ uri: target, width: step.width, height: step.height, bytes, format: usedFormat });
        if (note) setNotice(note);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resize failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    const problem = await saveToPhotos(result.uri);
    if (problem) setError(problem);
    else notify('Saved to Photos');
  };

  const plainEstimate =
    source && cap == null
      ? estimateOutputBytes(
          outputSize(source.width, source.height, chosenWidth).width,
          outputSize(source.width, source.height, chosenWidth).height,
          format === 'png' ? 1 : Number(quality),
          format,
        )
      : null;
  const plainDims = source ? outputSize(source.width, source.height, chosenWidth) : null;
  const liveWarning = source && live && cap != null ? fitWarning(live, chosenWidth, cap) : null;

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
          <Text style={type.label}>For</Text>
          <View style={styles.chips}>
            {PRESETS.map((p) => {
              const idx = WIDTHS.indexOf(p.width);
              const active = widthOverride == null && idx === widthIdx && quality === p.quality && !compressOnly && sizeId == null;
              return (
                <PrimaryChip
                  key={p.label}
                  label={p.label}
                  active={active}
                  onPress={() => {
                    setWidthIdx(idx);
                    setWidthOverride(null);
                    setQuality(p.quality);
                    setCompressOnly(false);
                    setSizeId(null);
                    setResult(null);
                  }}
                />
              );
            })}
            {PASSPORT_LIMITS.map((p) => {
              const active = sizeId === p.id && widthOverride === p.width && !compressOnly;
              return (
                <PrimaryChip
                  key={p.id}
                  label={p.label}
                  active={active}
                  onPress={() => {
                    setWidthOverride(p.width);
                    setSizeId(p.id);
                    setCompressOnly(false);
                    setResult(null);
                  }}
                />
              );
            })}
          </View>
          {PRESETS.filter(
            (p) => widthOverride == null && WIDTHS.indexOf(p.width) === widthIdx && quality === p.quality && sizeId == null,
          ).map((p) => (
            <Text key={p.label} style={type.small}>
              {p.label}: {p.note}
            </Text>
          ))}
          {PASSPORT_LIMITS.filter((p) => sizeId === p.id).map((p) => (
            <Text key={p.id} style={type.small}>
              {p.label}: {p.note}
            </Text>
          ))}
          <Text style={type.label}>Mode</Text>
          <Segmented
            options={[
              { id: 'dimensions', label: 'Dimensions' },
              { id: 'compress', label: 'Compress only' },
            ]}
            value={compressOnly ? 'compress' : 'dimensions'}
            onChange={(id) => {
              setCompressOnly(id === 'compress');
              setWidthOverride(null);
              setResult(null);
            }}
          />
          {!compressOnly && (
            <>
              <Text style={type.label}>Width</Text>
              <View style={styles.chips}>
                {WIDTHS.map((w, i) => {
                  const active = widthOverride == null && i === widthIdx;
                  const disabled = w > source.width;
                  return (
                    <PrimaryChip
                      key={w}
                      label={`${w}`}
                      active={active}
                      disabled={disabled}
                      onPress={() => {
                        setWidthIdx(i);
                        setWidthOverride(null);
                        setResult(null);
                      }}
                    />
                  );
                })}
              </View>
            </>
          )}
          <Text style={type.label}>Max file size</Text>
          <View style={styles.chips}>
            {SIZE_CHIPS.map((c) => (
              <PrimaryChip
                key={c.id}
                label={c.label}
                active={sizeId === c.id}
                onPress={() => {
                  setSizeId(sizeId === c.id ? null : c.id);
                  setWidthOverride(null);
                  setResult(null);
                }}
              />
            ))}
            <PrimaryChip
              label="Custom"
              active={sizeId === 'custom'}
              onPress={() => {
                setSizeId(sizeId === 'custom' ? null : 'custom');
                setResult(null);
              }}
            />
          </View>
          {sizeId === 'custom' && (
            <View style={styles.customRow}>
              <View style={styles.customField}>
                <Field
                  value={customAmount}
                  onChange={(v) => {
                    setCustomAmount(v);
                    setResult(null);
                  }}
                  placeholder="Size"
                  keyboard="decimal-pad"
                />
              </View>
              <Segmented
                options={[
                  { id: 'KB' as SizeUnit, label: 'KB' },
                  { id: 'MB' as SizeUnit, label: 'MB' },
                ]}
                value={customUnit}
                onChange={(u) => {
                  setCustomUnit(u);
                  setResult(null);
                }}
              />
            </View>
          )}
          {cap == null && (
            <>
              <Text style={type.label}>Quality</Text>
              <Segmented
                options={QUALITIES.map((q) => ({ id: q.id as string, label: q.label }))}
                value={quality}
                onChange={(q) => {
                  setQuality(q);
                  setResult(null);
                }}
              />
            </>
          )}
          <Text style={type.label}>Format</Text>
          <Segmented
            options={[
              { id: 'jpeg' as ResizeFormat, label: 'JPEG' },
              { id: 'png' as ResizeFormat, label: 'PNG' },
              { id: 'heic' as ResizeFormat, label: 'HEIC' },
            ]}
            value={format}
            onChange={(f) => {
              setFormat(f);
              setResult(null);
            }}
          />
          <PrimaryChip
            label={stripMetadata ? 'Strip location & camera info' : 'Keep camera info'}
            active={stripMetadata}
            onPress={() => setStripMetadata((v) => !v)}
          />
          <Text style={type.small}>
            {stripMetadata
              ? 'Location and camera info are removed. JPEG is the usual choice for photos.'
              : 'Camera info is kept when the phone can. A resized photo is still a new file.'}
          </Text>
          {sizeId === 'custom' && cap == null ? (
            <Text style={styles.warning}>Enter a max size in KB or MB.</Text>
          ) : live && cap != null ? (
            <Text style={type.small}>
              Estimate: {live.width} by {live.height}, about {formatBytes(live.bytes)}
              {'\n'}
              Now {source.width} × {source.height} · {formatBytes(source.bytes)}
            </Text>
          ) : (
            plainDims &&
            plainEstimate != null && (
              <Text style={type.small}>
                Estimate: {plainDims.width} by {plainDims.height}, about {formatBytes(plainEstimate)}
                {'\n'}
                Now {source.width} × {source.height} · {formatBytes(source.bytes)}
              </Text>
            )
          )}
          {!!liveWarning && <Text style={styles.warning}>{liveWarning}</Text>}
          <PrimaryButton
            label={busy ? 'Resizing…' : 'Resize'}
            onPress={run}
            disabled={busy}
            orange
          />
        </>
      )}
      {!!notice && <Text style={styles.warning}>{notice}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && source && (
        <Card style={styles.resultCard}>
          <Text style={type.label}>Done</Text>
          <Text style={type.numSmall}>
            {result.width} × {result.height} · {formatBytes(result.bytes)}
          </Text>
          <Text style={type.small}>
            Was {source.width} × {source.height} · {formatBytes(source.bytes)} — saved{' '}
            {formatBytes(Math.max(0, source.bytes - result.bytes))}
          </Text>
          <PrimaryButton label="Save to Photos" onPress={save} />
          <GhostButton
            label="Share image"
            onPress={() => void shareFile(result.uri, MIME[result.format])}
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
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customField: { flex: 1 },
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
  warning: { color: colors.orange, fontSize: 15 },
  error: { color: colors.danger, fontSize: 15 },
});
