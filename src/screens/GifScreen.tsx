import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, saveToPhotos, shareFile } from '../lib/files';
import { makeGifFromVideo, planGif, type GifResult } from '../lib/gif';
import { colors, type } from '../theme';

/**
 * Video to GIF — plainly simplified: the first 5 seconds, 8 frames a
 * second, 360px wide, one fixed palette. The label in the UI says so.
 */
export function GifScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
}) {
  const [video, setVideo] = useState<{
    uri: string;
    durationMs: number | null;
  } | null>(null);
  const [result, setResult] = useState<GifResult | null>(null);
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(5);
  const [fps, setFps] = useState('10');
  const [width, setWidth] = useState('360');
  const [colour, setColour] = useState<'best' | 'fast'>('best');
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationSec = (video?.durationMs ?? 0) / 1000;

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is off. Turn it on in Settings to pick a video.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    if (a) {
      setVideo({ uri: a.uri, durationMs: a.duration ?? null });
      setStart(0);
      setResult(null);
      setError(null);
    }
  };

  const run = async () => {
    if (!video) return;
    setBusy(true);
    setError(null);
    try {
      const out = await makeGifFromVideo(video.uri, {
        durationSec: (video.durationMs ?? 5000) / 1000,
        startSec: start,
        lengthSec: length,
        fps: Number(fps),
        width: Number(width),
        colour,
        toPng: async (jpegUri, w) => {
          const png = await manipulateAsync(jpegUri, [{ resize: { width: w } }], {
            format: SaveFormat.PNG,
          });
          return { uri: png.uri, width: png.width, height: png.height };
        },
        onProgress: (done, total) => setProgress(`Frame ${done} of ${total}`),
      });
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That video couldn’t be read.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const save = async () => {
    if (!result) return;
    const problem = await saveToPhotos(result.uri);
    if (problem) setError(problem);
    else notify('Saved to Photos');
  };

  return (
    <ToolShell title="Video to GIF" onBack={onBack}>
      <Text style={type.small}>
        Pick a stretch of up to 10 seconds. “Best colour” builds a palette
        from your clip, so skin tones and gradients look right.
      </Text>
      <PrimaryButton
        label={video ? 'Pick a different video' : 'Pick a video'}
        onPress={pick}
      />
      {video && (
        <>
          <Stepper
            label="Start at"
            value={start}
            unit="s"
            onChange={(v) => setStart(Math.max(0, Math.min(v, Math.max(0, durationSec - 1))))}
          />
          <Stepper
            label="Length"
            value={length}
            unit="s"
            onChange={(v) => setLength(Math.max(1, Math.min(10, v)))}
          />
          <Text style={type.small}>
            {planGif({ durationSec, startSec: start, lengthSec: length, fps: Number(fps) }).times.length} frames
            {durationSec > 0 ? ` · clip is ${Math.round(durationSec)} s` : ''}
          </Text>
          <Text style={type.label}>Smoothness</Text>
          <Segmented
            options={[
              { id: '6', label: '6 fps' },
              { id: '10', label: '10 fps' },
              { id: '15', label: '15 fps' },
            ]}
            value={fps}
            onChange={setFps}
          />
          <Text style={type.label}>Size</Text>
          <Segmented
            options={[
              { id: '240', label: 'Small' },
              { id: '360', label: 'Medium' },
              { id: '480', label: 'Large' },
            ]}
            value={width}
            onChange={setWidth}
          />
          <Segmented
            options={[
              { id: 'best', label: 'Best colour' },
              { id: 'fast', label: 'Fast' },
            ]}
            value={colour}
            onChange={setColour}
          />
        </>
      )}
      {video && (
        <PrimaryButton
          label={busy ? 'Making GIF…' : 'Make GIF'}
          onPress={run}
          disabled={busy}
          orange
        />
      )}
      {!!progress && <Text style={type.small}>{progress}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && (
        <Card style={styles.resultCard}>
          <Image source={{ uri: result.uri }} style={styles.gif} />
          <Text style={[type.numSmall, styles.center]}>
            {result.width} × {result.height} · {result.frames} frames ·{' '}
            {formatBytes(result.bytes)}
          </Text>
          <PrimaryButton label="Save to Photos" onPress={save} />
          <View>
            <PrimaryButton
              label="Share GIF"
              onPress={() => void shareFile(result.uri, 'image/gif')}
            />
          </View>
        </Card>
      )}
    </ToolShell>
  );
}

function Stepper({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={type.body}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable accessibilityLabel={`${label} less`} onPress={() => onChange(value - 1)} hitSlop={8}>
          <Text style={styles.stepBtn}>−</Text>
        </Pressable>
        <Text style={type.numSmall}>
          {value} {unit}
        </Text>
        <Pressable accessibilityLabel={`${label} more`} onPress={() => onChange(value + 1)} hitSlop={8}>
          <Text style={styles.stepBtn}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { fontSize: 26, fontWeight: '700', color: colors.accent, paddingHorizontal: 6 },
  resultCard: { gap: 12, alignItems: 'stretch' },
  gif: { width: '100%', height: 240, borderRadius: 10, backgroundColor: colors.border },
  center: { textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15 },
});
