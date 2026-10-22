import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
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
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';

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

type Adjust = {
  widthIdx: number;
  widthOverride: number | null;
  quality: string;
  compressOnly: boolean;
  sizeId: string | null;
  customAmount: string;
  customUnit: SizeUnit;
  format: ResizeFormat;
  stripMetadata: boolean;
};

const initialAdjust: Adjust = {
  widthIdx: 2,
  widthOverride: null,
  quality: '0.7',
  compressOnly: false,
  sizeId: null,
  customAmount: '',
  customUnit: 'KB',
  format: 'jpeg',
  stripMetadata: true,
};

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
  const { type, styles } = useThemed(makeStyles);
  const [source, setSource] = useState<Source | null>(null);
  const adjust = useUndoHistory<Adjust>(initialAdjust, { shake: true });
  const {
    widthIdx,
    widthOverride,
    quality,
    compressOnly,
    sizeId,
    customAmount,
    customUnit,
    format,
    stripMetadata,
  } = adjust.present;
  const patch = (part: Partial<Adjust>, group = false) => {
    adjust.commit((current) => ({ ...current, ...part }), group);
  };
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
    patch({ widthIdx: Math.min(2, fit), widthOverride: null });
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
    <ToolShell
      title="Resize photo"
      onBack={onBack}
      undo={{
        canUndo: adjust.canUndo,
        canRedo: adjust.canRedo,
        onUndo: () => adjust.undo(),
        onRedo: () => adjust.redo(),
      }}
    >
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
                    patch({
                      widthIdx: idx,
                      widthOverride: null,
                      quality: p.quality,
                      compressOnly: false,
                      sizeId: null,
                    });
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
                    patch({ widthOverride: p.width, sizeId: p.id, compressOnly: false });
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
              patch({ compressOnly: id === 'compress', widthOverride: null });
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
                        patch({ widthIdx: i, widthOverride: null });
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
                  patch({ sizeId: sizeId === c.id ? null : c.id, widthOverride: null });
                  setResult(null);
                }}
              />
            ))}
            <PrimaryChip
              label="Custom"
              active={sizeId === 'custom'}
              onPress={() => {
                patch({ sizeId: sizeId === 'custom' ? null : 'custom' });
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
                    patch({ customAmount: v }, true);
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
                  patch({ customUnit: u });
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
                  patch({ quality: q });
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
              patch({ format: f });
              setResult(null);
            }}
          />
          <PrimaryChip
            label={stripMetadata ? 'Strip location & camera info' : 'Keep camera info'}
            active={stripMetadata}
            onPress={() => patch({ stripMetadata: !stripMetadata })}
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
  const { styles } = useThemed(makeStyles);
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

function makeStyles(p: Palette) {
  return StyleSheet.create({
    previewCard: { alignItems: 'center', gap: 8 },
    preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: p.separator },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    customField: { flex: 1 },
    chip: {
      fontSize: 16,
      fontWeight: '700',
      color: p.textPrimary,
      backgroundColor: p.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      overflow: 'hidden',
    },
    chipActive: { backgroundColor: p.primary, color: p.onPrimary },
    resultCard: { gap: 10 },
    warning: { color: p.warning, fontSize: 15 },
    error: { color: p.destructive, fontSize: 15 },
  });
}
