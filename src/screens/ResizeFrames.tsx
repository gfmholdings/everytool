import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { formatBytes, saveToPhotos, shareFile } from '../lib/files';
import {
  PASSPORT_GROUP,
  PRESET_GROUPS,
  clampCrop,
  cropForFrame,
  faceGuideLayout,
  fillCropRect,
  findPreset,
  fitExportSize,
  parseCustomFrame,
  rotatedBounds,
  sheetPlan,
  type CropMode,
  type LengthUnit,
  type ResizePreset,
} from '../lib/resizePresets';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';

type FrameDraft = {
  presetId: string | null;
  mode: CropMode;
  rotation: number;
  offsetX: number;
  offsetY: number;
  customW: string;
  customH: string;
  unit: LengthUnit;
  dpi: string;
};

const initialDraft: FrameDraft = {
  presetId: PRESET_GROUPS[0]?.presets[0]?.id ?? null,
  mode: 'fill',
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  customW: '',
  customH: '',
  unit: 'px',
  dpi: '',
};

/**
 * Social and passport frames under the width-chip resize flow.
 * Platform names that would collide with those chips are renamed here.
 */
export function ResizeFrames({
  source,
  notify,
}: {
  source: { uri: string; width: number; height: number };
  notify: (msg: string) => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const draft = useUndoHistory<FrameDraft>(initialDraft);
  const [groupId, setGroupId] = useState(PRESET_GROUPS[0]?.id ?? 'facebook');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ uri: string; width: number; height: number; bytes: number; note: string } | null>(
    null,
  );

  const groups = [...PRESET_GROUPS, PASSPORT_GROUP];
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  const preset = draft.present.presetId ? findPreset(draft.present.presetId) : null;
  const custom = parseCustomFrame({
    width: draft.present.customW,
    height: draft.present.customH,
    unit: draft.present.unit,
    dpi: draft.present.dpi,
  });
  const frame = preset
    ? { width: preset.width, height: preset.height }
    : custom
      ? { width: custom.width, height: custom.height }
      : null;

  const turned = (width: number, height: number, rotation: number) => {
    const box = rotatedBounds(width, height, rotation);
    return { width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) };
  };

  const selectPreset = (next: ResizePreset) => {
    draft.commit((current) => ({
      ...current,
      presetId: next.id,
      offsetX: 0,
      offsetY: 0,
      customW: '',
      customH: '',
    }));
    setResult(null);
  };

  const nudge = (dx: number, dy: number) => {
    if (!frame || draft.present.mode !== 'fill') return;
    const size = turned(source.width, source.height, draft.present.rotation);
    const base = cropForFrame(size, frame, 'fill', 0);
    if (!base) return;
    draft.commit((current) => {
      const next = clampCrop(
        { ...base, offsetX: current.offsetX + dx, offsetY: current.offsetY + dy },
        size,
        frame,
      );
      return { ...current, offsetX: next.offsetX, offsetY: next.offsetY };
    });
    setResult(null);
  };

  const exportFrame = async () => {
    if (!frame || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rotation = ((draft.present.rotation % 360) + 360) % 360;
      let uri = source.uri;
      let size = { width: source.width, height: source.height };
      if (rotation !== 0) {
        const spun = await manipulateAsync(uri, [{ rotate: rotation }], {
          format: SaveFormat.JPEG,
          compress: 0.92,
        });
        uri = spun.uri;
        size = { width: spun.width, height: spun.height };
      }
      let outUri = uri;
      let outW = size.width;
      let outH = size.height;
      let note = '';
      if (draft.present.mode === 'fill') {
        const crop = clampCrop(
          {
            ...(cropForFrame(size, frame, 'fill', 0) ?? { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 }),
            offsetX: draft.present.offsetX,
            offsetY: draft.present.offsetY,
          },
          size,
          frame,
        );
        const rect = fillCropRect(size, frame, crop);
        if (!rect) throw new Error('That frame doesn’t fit this photo.');
        const saved = await manipulateAsync(
          uri,
          [
            { crop: rect },
            { resize: { width: frame.width, height: frame.height } },
          ],
          { format: SaveFormat.JPEG, compress: 0.9 },
        );
        outUri = saved.uri;
        outW = saved.width;
        outH = saved.height;
        note = 'Filled the frame.';
      } else {
        const fitted = fitExportSize(size, frame);
        if (!fitted) throw new Error('That frame doesn’t fit this photo.');
        const saved = await manipulateAsync(uri, [{ resize: fitted }], {
          format: SaveFormat.JPEG,
          compress: 0.9,
        });
        outUri = saved.uri;
        outW = saved.width;
        outH = saved.height;
        note = `Fits inside ${frame.width} by ${frame.height}.`;
      }
      if (preset?.kind === 'passport') {
        const sheet = sheetPlan(preset);
        const copies = sheet && sheet.copies > 0 ? sheet.copies : 0;
        note =
          copies > 0
            ? `${note} A 4 by 6 inch sheet holds ${copies} copies. This export is one photo.`
            : `${note} This export is one photo.`;
        const guide = faceGuideLayout(preset);
        if (guide) note = `${note} ${preset.overlay.kind === 'face-guide' ? preset.overlay.label : ''}`;
      }
      const bytes = new File(outUri).size ?? 0;
      setResult({ uri: outUri, width: outW, height: outH, bytes, note: note.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
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

  return (
    <View style={styles.block}>
      <Text style={type.label}>Frame</Text>
      <Text style={type.small}>
        Fill crops to the frame. Fit keeps the whole photo inside it, without empty bars.
      </Text>
      <View style={styles.undoRow}>
        <GhostButton label="Undo frame" onPress={() => draft.undo()} />
        <GhostButton label="Redo frame" onPress={() => draft.redo()} />
      </View>
      <View style={styles.wrap}>
        {groups.map((item) => (
          <Chip
            key={item.id}
            label={publicGroup(item.label)}
            active={item.id === groupId}
            onPress={() => setGroupId(item.id)}
          />
        ))}
        <Chip
          label="Custom frame"
          active={draft.present.presetId == null}
          onPress={() => {
            draft.commit((current) => ({ ...current, presetId: null, offsetX: 0, offsetY: 0 }));
            setResult(null);
          }}
        />
      </View>
      {group && draft.present.presetId != null && (
        <View style={styles.wrap}>
          {group.presets.map((item) => (
            <Chip
              key={item.id}
              label={publicPreset(item)}
              active={item.id === draft.present.presetId}
              onPress={() => selectPreset(item)}
            />
          ))}
        </View>
      )}
      {preset && (
        <Text style={type.small}>
          {preset.width} by {preset.height}. {safeNote(preset.note)}
        </Text>
      )}
      {draft.present.presetId == null && (
        <>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field
                value={draft.present.customW}
                onChange={(value) => draft.commit((current) => ({ ...current, customW: value }), true)}
                placeholder="Width"
                keyboard="decimal-pad"
              />
            </View>
            <View style={styles.flex}>
              <Field
                value={draft.present.customH}
                onChange={(value) => draft.commit((current) => ({ ...current, customH: value }), true)}
                placeholder="Height"
                keyboard="decimal-pad"
              />
            </View>
          </View>
          <Segmented
            options={[
              { id: 'px' as LengthUnit, label: 'px' },
              { id: 'mm' as LengthUnit, label: 'mm' },
              { id: 'cm' as LengthUnit, label: 'cm' },
              { id: 'in' as LengthUnit, label: 'in' },
            ]}
            value={draft.present.unit}
            onChange={(unit) => draft.commit((current) => ({ ...current, unit }))}
          />
          <Field
            value={draft.present.dpi}
            onChange={(value) => draft.commit((current) => ({ ...current, dpi: value }), true)}
            placeholder="DPI (300 for print)"
            keyboard="number-pad"
          />
          {custom && (
            <Text style={type.small}>
              {custom.width} by {custom.height} px
            </Text>
          )}
        </>
      )}
      <Segmented
        options={[
          { id: 'fill' as CropMode, label: 'Fill' },
          { id: 'fit' as CropMode, label: 'Fit' },
        ]}
        value={draft.present.mode}
        onChange={(mode) => {
          draft.commit((current) => ({ ...current, mode, offsetX: 0, offsetY: 0 }));
          setResult(null);
        }}
      />
      <View style={styles.row}>
        <GhostButton
          label="Turn left"
          onPress={() => {
            draft.commit((current) => ({ ...current, rotation: current.rotation - 90, offsetX: 0, offsetY: 0 }));
            setResult(null);
          }}
        />
        <GhostButton
          label="Turn right"
          onPress={() => {
            draft.commit((current) => ({ ...current, rotation: current.rotation + 90, offsetX: 0, offsetY: 0 }));
            setResult(null);
          }}
        />
      </View>
      {draft.present.mode === 'fill' && (
        <View style={styles.row}>
          <GhostButton label="Nudge left" onPress={() => nudge(-24, 0)} />
          <GhostButton label="Nudge right" onPress={() => nudge(24, 0)} />
          <GhostButton label="Nudge up" onPress={() => nudge(0, -24)} />
          <GhostButton label="Nudge down" onPress={() => nudge(0, 24)} />
        </View>
      )}
      <PrimaryButton
        label={busy ? 'Exporting…' : 'Export frame'}
        onPress={() => void exportFrame()}
        disabled={busy || !frame}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && (
        <Card style={styles.result}>
          <Text style={type.label}>Frame ready</Text>
          <Text style={type.numSmall}>
            {result.width} by {result.height} · {formatBytes(result.bytes)}
          </Text>
          {!!result.note && <Text style={type.small}>{safeNote(result.note)}</Text>}
          <PrimaryButton label="Save frame" onPress={() => void save()} />
          <GhostButton label="Share frame" onPress={() => void shareFile(result.uri, 'image/jpeg')} />
        </Card>
      )}
    </View>
  );
}

function publicGroup(label: string): string {
  if (label === 'WhatsApp') return 'Chat';
  return label;
}

function publicPreset(preset: ResizePreset): string {
  const platform = preset.platform === 'WhatsApp' ? 'Chat' : preset.platform;
  return `${platform} ${preset.label}`;
}

function safeNote(note: string): string {
  return note.split('WhatsApp').join('Chat');
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { styles } = useThemed(makeStyles);
  return (
    <Text onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      {label}
    </Text>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    block: { gap: 10, marginTop: 8 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    undoRow: { flexDirection: 'row', gap: 8 },
    flex: { flex: 1 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: p.secondary,
      color: p.onSecondary,
      overflow: 'hidden',
      fontWeight: '600',
    },
    chipOn: { backgroundColor: p.primary, color: p.onPrimary },
    result: { gap: 8 },
    error: { color: p.destructive, fontSize: 15 },
  });
}
