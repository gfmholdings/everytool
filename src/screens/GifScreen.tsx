import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card, PrimaryButton, ToolShell } from '../components/ui';
import { formatBytes, saveToPhotos, shareFile } from '../lib/files';
import { GIF_WIDTH, makeGifFromVideo, type GifResult } from '../lib/gif';
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
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        toPng: async (jpegUri) => {
          const png = await manipulateAsync(
            jpegUri,
            [{ resize: { width: GIF_WIDTH } }],
            { format: SaveFormat.PNG },
          );
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
        Simplified GIF: first 5 seconds, 8 frames a second, one palette.
      </Text>
      <PrimaryButton
        label={video ? 'Pick a different video' : 'Pick a video'}
        onPress={pick}
      />
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

const styles = StyleSheet.create({
  resultCard: { gap: 12, alignItems: 'stretch' },
  gif: { width: '100%', height: 240, borderRadius: 10, backgroundColor: colors.border },
  center: { textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15 },
});
