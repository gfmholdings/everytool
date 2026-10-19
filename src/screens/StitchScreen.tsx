import * as Clipboard from 'expo-clipboard';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { shareFile } from '../lib/files';
import { drainBroadcastInbox, clearBroadcastInbox } from '../lib/incoming';
import { stitchRecordedFrames, stitchShots, type ShotInput, type StitchResult } from '../lib/stitch';
import { colors, type } from '../theme';

type Mode = 'record' | 'photos';

export function StitchScreen({
  onBack,
  initialShots,
  notify,
}: {
  onBack: () => void;
  initialShots?: ShotInput[];
  notify: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('record');
  const [shots, setShots] = useState<ShotInput[]>(initialShots ?? []);
  const [result, setResult] = useState<StitchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<
    { uri: string; width: number; height: number; offsetY: number }[] | null
  >(null);

  // A finished screen recording lands in the broadcast inbox; offer it the
  // moment this screen opens.
  useEffect(() => {
    let live = true;
    void drainBroadcastInbox().then((frames) => {
      if (live && frames.length > 0) setRecorded(frames);
    });
    return () => {
      live = false;
    };
  }, []);

  const pickShots = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is off. Turn it on in Settings to pick shots.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 1,
    });
    if (res.canceled) return;
    const picked: ShotInput[] = res.assets.map((a) => ({
      uri: a.uri,
      width: a.width,
      height: a.height,
    }));
    setShots((s) => [...s, ...picked]);
    setResult(null);
    setError(null);
  };

  const runStitch = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await stitchShots(shots);
      setResult(out);
      if (out.stacked) {
        notify('Stitched — some shots didn’t overlap, so they were stacked.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stitching failed.');
    } finally {
      setBusy(false);
    }
  };

  const runRecorded = async () => {
    if (!recorded) return;
    setBusy(true);
    setError(null);
    try {
      const out = await stitchRecordedFrames(recorded);
      setResult(out);
      clearBroadcastInbox();
      setRecorded(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stitching failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Photo saving is off. Turn it on in Settings to save.');
      return;
    }
    await MediaLibrary.saveToLibraryAsync(result.uri);
    notify('Saved to Photos');
  };

  const summary = useMemo(() => {
    if (!result) return null;
    return `${result.width} × ${result.height} · one PNG`;
  }, [result]);

  return (
    <ToolShell title="Long screenshot" onBack={onBack}>
      <Segmented
        options={[
          { id: 'record', label: 'Hold & drag' },
          { id: 'photos', label: 'From photos' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'record' && (
        <>
          <Card>
            <Text style={type.h2}>Hold, drag, done</Text>
            <Text style={[type.body, styles.spaced]}>
              In Control Center, hold the record button and choose
              Everytool. Then scroll the page — slowly, screen by screen.
              Stop the recording and your long screenshot is made here.
            </Text>
            <Text style={[type.small, styles.spaced]}>
              The frames are stitched on this phone. Nothing is uploaded.
            </Text>
          </Card>
          {recorded ? (
            <Card>
              <Text style={type.body}>
                A recording is ready — {recorded.length} frames.
              </Text>
              <View style={styles.spaced}>
                <PrimaryButton
                  label={busy ? 'Stitching…' : 'Stitch the recording'}
                  onPress={runRecorded}
                  disabled={busy}
                />
              </View>
            </Card>
          ) : (
            <Card>
              <Text style={type.small}>
                No recording waiting. Start one from Control Center and it
                will appear here.
              </Text>
            </Card>
          )}
        </>
      )}

      {mode === 'photos' && (
        <>
          {shots.length > 0 && (
            <View style={styles.thumbs}>
              {shots.map((s, i) => (
                <Pressable
                  key={`${s.uri}-${i}`}
                  onPress={() =>
                    setShots((all) => all.filter((_, j) => j !== i))
                  }
                >
                  <Image source={{ uri: s.uri }} style={styles.thumb} />
                </Pressable>
              ))}
            </View>
          )}
          <PrimaryButton
            label={shots.length ? 'Add more photos' : 'Add your photos'}
            onPress={pickShots}
          />
          {shots.length >= 2 && (
            <PrimaryButton
              label={busy ? 'Stitching…' : `Stitch ${shots.length} shots`}
              onPress={runStitch}
              disabled={busy}
              orange
            />
          )}
          <Text style={type.small}>
            Shots are matched where they overlap — top to bottom, in order.
            Tap a thumbnail to remove it.
          </Text>
        </>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <>
          <Card style={styles.resultCard}>
            <Text style={type.label}>Stitched long screenshot</Text>
            <Image
              source={{ uri: result.uri }}
              style={styles.resultImage}
              resizeMode="contain"
            />
            <Text style={[type.numSmall, styles.center]}>{summary}</Text>
            {result.stacked && (
              <Text style={[type.small, styles.center]}>
                Some shots didn’t overlap — they were stacked in order.
              </Text>
            )}
          </Card>
          <PrimaryButton label="Save image" onPress={save} />
          <GhostButton
            label="Share image"
            onPress={() => void shareFile(result.uri, 'image/png')}
          />
          <GhostButton
            label="Copy image"
            onPress={async () => {
              const png = await manipulateAsync(result.uri, [], {
                format: SaveFormat.PNG,
                base64: true,
              });
              if (png.base64) {
                await Clipboard.setImageAsync(png.base64);
                notify('Copied');
              }
            }}
          />
        </>
      )}
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  spaced: { marginTop: 10 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 64, height: 96, borderRadius: 10, backgroundColor: colors.border },
  resultCard: { alignItems: 'stretch', gap: 10 },
  resultImage: { width: '100%', height: 420, borderRadius: 10 },
  center: { textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15 },
});
