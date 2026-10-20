import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState as RNAppState,
  FlatList,
  Linking,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, saveToPhotos, shareFile } from '../lib/files';
import { clearBroadcastInbox, readBroadcastInbox, type BroadcastInbox } from '../lib/incoming';
import {
  countSessionShots,
  deleteSessionShots,
  endSession,
  ensurePhotoAccess,
  sessionShots,
  sessionStart,
  startSession,
  type PhotoAccess,
} from '../lib/screenshotSession';
import {
  COPY_MAX_HEIGHT,
  stitchFrames,
  type ShotInput,
  type StitchPhase,
  type StitchResult,
} from '../lib/stitch';
import type { Segment } from '../lib/stitchCore';
import {
  requestNotificationPermission,
  sharedVaultAvailable,
  showBroadcastPicker,
} from '../store/sharedVault';
import { colors, type } from '../theme';

type Mode = 'session' | 'record' | 'photos';

const PHASE_LABEL: Record<StitchPhase, string> = {
  preparing: 'Preparing frames',
  reading: 'Reading frames',
  matching: 'Matching overlaps',
  writing: 'Writing the image',
};

/**
 * Long screenshot. Three ways in:
 *  - Screenshots (default): Start a session (here or the "Start Long
 *    Screenshot" control), take ordinary screenshots while scrolling in
 *    any app, then Stitch (here or the "Stitch Screenshots" control).
 *    Everytool joins every screenshot taken since Start.
 *  - Record:
 *   Record (here, or the "Record Long Screenshot" control) → Apple's
 *   broadcast sheet with Everytool preselected → scroll as long as you
 *   like → stop → Everytool stitches automatically → Save / Share / Copy.
 * Secondary flow: pick overlapping screenshots from Photos.
 */
export function StitchScreen({
  onBack,
  initialShots,
  recordRequest,
  sessionRequest,
  notify,
}: {
  onBack: () => void;
  initialShots?: ShotInput[];
  /** A new value asks the screen to raise the recorder (from a control). */
  recordRequest?: number;
  /** A new value asks the screen to stitch the session (from a control). */
  sessionRequest?: number;
  notify: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialShots?.length ? 'photos' : 'session');
  const [sessionAt, setSessionAt] = useState<number | null>(() => sessionStart());
  const [sessionCount, setSessionCount] = useState(0);
  const [photoAccess, setPhotoAccess] = useState<PhotoAccess | null>(null);
  const [sessionAssets, setSessionAssets] = useState<string[]>([]);
  const [shots, setShots] = useState<ShotInput[]>(initialShots ?? []);
  const [result, setResult] = useState<StitchResult | null>(null);
  const [resultFrom, setResultFrom] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inbox, setInbox] = useState<BroadcastInbox>({ frames: [], finished: false });
  const [viewer, setViewer] = useState(false);
  const autoStitched = useRef<string | null>(null);
  const busyRef = useRef(false);

  const onProgress = useCallback((phase: StitchPhase, done: number, total: number) => {
    setProgress(
      total > 1 ? `${PHASE_LABEL[phase]} · ${done} of ${total}` : `${PHASE_LABEL[phase]}…`,
    );
  }, []);

  const run = useCallback(
    async (inputs: ShotInput[], from: Mode): Promise<StitchResult | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const out = await stitchFrames(inputs, {
          mode: from === 'record' ? 'record' : 'photos',
          onProgress,
        });
        setResult(out);
        setResultFrom(from);
        if (out.stackedSeams > 0) {
          notify(
            `Stitched — ${out.stackedSeams} spot${out.stackedSeams === 1 ? '' : 's'} didn’t overlap and ${out.stackedSeams === 1 ? 'was' : 'were'} stacked.`,
          );
        }
        return out;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Stitching failed.');
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
        setProgress(null);
      }
    },
    [notify, onProgress],
  );

  // Watch the broadcast inbox while this screen is open: show live
  // progress during a recording and stitch the moment it stops.
  const poll = useCallback(async () => {
    const started = sessionStart();
    setSessionAt(started);
    if (started) {
      try {
        setSessionCount(await countSessionShots(started));
      } catch {
        // no Photos access yet
      }
    }
    const next = await readBroadcastInbox();
    setInbox(next);
    const key = next.frames.length > 0 ? `${next.frames[0]!.uri}#${next.frames.length}` : null;
    if (next.finished && key && autoStitched.current !== key && !busyRef.current) {
      autoStitched.current = key;
      setMode('record');
      void run(next.frames, 'record');
    }
  }, [run]);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), 1500);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') void poll();
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      sub.remove();
    };
  }, [poll]);

  // Frames are large; once a recording has been turned into an image and
  // the user leaves, they're no longer needed.
  const stitchedRecording = useRef(false);
  useEffect(() => {
    stitchedRecording.current = resultFrom === 'record' && result != null;
  }, [resultFrom, result]);
  useEffect(
    () => () => {
      if (stitchedRecording.current) clearBroadcastInbox();
    },
    [],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    await requestNotificationPermission();
    const shown = await showBroadcastPicker();
    if (!shown) {
      setError(
        sharedVaultAvailable()
          ? 'Couldn’t open the recorder here. Open Control Center, press and hold Screen Recording, choose Everytool, then Start Broadcast.'
          : 'Recording needs the installed Everytool app (not Expo Go).',
      );
    }
  }, []);

  const handledRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (recordRequest && handledRequest.current !== recordRequest) {
      handledRequest.current = recordRequest;
      setMode('record');
      // Let the app finish coming to the foreground before the sheet.
      const t = setTimeout(() => void startRecording(), 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [recordRequest, startRecording]);

  // ---- Screenshot session ------------------------------------------------

  const beginSession = async () => {
    setError(null);
    const access = await ensurePhotoAccess();
    setPhotoAccess(access);
    if (access === 'denied') {
      setError('Everytool needs Photos access to find your screenshots.');
      return;
    }
    if (access === 'limited') {
      setError(
        'Photos access is “Limited”, so new screenshots stay hidden from Everytool. Choose Full Access in Settings → Everytool → Photos.',
      );
      return;
    }
    const now = Date.now();
    startSession(now);
    setSessionAt(now);
    setSessionCount(0);
    setResult(null);
    notify('Session started — take screenshots as you scroll');
  };

  const finishSession = useCallback(async () => {
    const started = sessionStart();
    if (!started) {
      setError('No session running. Tap Start, then take screenshots as you scroll.');
      return;
    }
    setMode('session');
    setError(null);
    const access = await ensurePhotoAccess();
    setPhotoAccess(access);
    if (access !== 'all') {
      setError('Everytool needs Full Access to Photos to find your screenshots.');
      return;
    }
    setProgress('Finding your screenshots…');
    let shotsTaken: Awaited<ReturnType<typeof sessionShots>> = [];
    try {
      shotsTaken = await sessionShots(started);
    } catch {
      setProgress(null);
      setError('Couldn’t read your screenshots from Photos.');
      return;
    }
    setProgress(null);
    if (shotsTaken.length < 2) {
      setError(
        shotsTaken.length === 1
          ? 'Only 1 screenshot so far — scroll a little and take at least one more.'
          : 'No screenshots yet. Take a screenshot, scroll down a bit, take another — then Stitch.',
      );
      return;
    }
    const out = await run(shotsTaken, 'session');
    if (out) {
      endSession();
      setSessionAt(null);
      setSessionAssets(shotsTaken.map((x) => x.assetId));
    }
  }, [run]);

  const cancelSession = () => {
    endSession();
    setSessionAt(null);
    setSessionCount(0);
    notify('Session cancelled');
  };

  const deleteSources = async () => {
    const ok = await deleteSessionShots(sessionAssets);
    if (ok) {
      notify(`Deleted ${sessionAssets.length} screenshots`);
      setSessionAssets([]);
    }
  };

  const handledSession = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (sessionRequest && handledSession.current !== sessionRequest) {
      handledSession.current = sessionRequest;
      const t = setTimeout(() => void finishSession(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [sessionRequest, finishSession]);

  const pickShots = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is off. Turn it on in Settings to pick shots.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: 0,
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

  const move = (index: number, dir: -1 | 1) =>
    setShots((all) => {
      const j = index + dir;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      const [item] = next.splice(index, 1);
      if (item) next.splice(j, 0, item);
      return next;
    });

  const save = async () => {
    if (!result) return;
    const problem = await saveToPhotos(result.uri);
    if (problem) setError(problem);
    else notify('Saved to Photos');
  };

  const copyImage = async () => {
    if (!result) return;
    try {
      const b64 = await new File(result.uri).base64();
      await Clipboard.setImageAsync(b64);
      notify('Copied');
    } catch {
      setError('Couldn’t copy this image — use Share instead.');
    }
  };

  const discardRecording = () => {
    clearBroadcastInbox();
    setInbox({ frames: [], finished: false });
    if (resultFrom === 'record') setResult(null);
    notify('Recording discarded');
  };

  const recording = inbox.frames.length > 0 && !inbox.finished;

  return (
    <ToolShell title="Long screenshot" onBack={onBack}>
      <Segmented
        options={[
          { id: 'session', label: 'Screenshots' },
          { id: 'record', label: 'Record' },
          { id: 'photos', label: 'Pick photos' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'session' && (
        <>
          <Card>
            <Text style={type.h2}>Screenshot as you scroll</Text>
            <Text style={[type.body, styles.spaced]}>
              1. Tap Start.{'\n'}
              2. In any app, take a screenshot (side button + volume up),
              scroll down a little, take another — as many as you like.
              Keep a bit of overlap between them.{'\n'}
              3. Come back and tap Stitch. Everytool joins every screenshot
              taken since Start into one long image.
            </Text>
            <Text style={[type.small, styles.spaced]}>
              Tip: Settings → Accessibility → Touch → Back Tap → Double Tap →
              Screenshot lets you capture with a tap on the back of the
              phone. You can also add “Start Long Screenshot” and “Stitch
              Screenshots” to Control Center.
            </Text>
          </Card>
          {sessionAt ? (
            <Card>
              <Text style={type.body}>
                Session running — {sessionCount} screenshot
                {sessionCount === 1 ? '' : 's'} so far.
              </Text>
              <Text style={[type.small, styles.spaced]}>
                Started{' '}
                {new Date(sessionAt).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                . Leave Everytool and keep capturing, or stitch now.
              </Text>
              <View style={styles.rowGap}>
                <PrimaryButton
                  label={busy ? 'Stitching…' : `Stitch ${sessionCount >= 2 ? `${sessionCount} screenshots` : 'screenshots'}`}
                  onPress={() => void finishSession()}
                  disabled={busy}
                  orange
                  testID="stitch.session.finish"
                />
                <GhostButton label="Cancel session" onPress={cancelSession} />
              </View>
            </Card>
          ) : (
            <PrimaryButton
              label="Start"
              onPress={() => void beginSession()}
              disabled={busy}
              orange
              testID="stitch.session.start"
            />
          )}
          {photoAccess === 'limited' && (
            <GhostButton label="Open Settings" onPress={() => void Linking.openSettings()} />
          )}
        </>
      )}

      {mode === 'record' && (
        <>
          <Card>
            <Text style={type.h2}>Scroll as far as you like</Text>
            <Text style={[type.body, styles.spaced]}>
              Tap Record, then Start Broadcast. Go to the page you want and
              scroll down steadily. Stop from the red recording pill or
              Control Center — your long screenshot is made right here.
            </Text>
            <Text style={[type.small, styles.spaced]}>
              Frames are stitched on this phone. Nothing is uploaded.
            </Text>
          </Card>
          <PrimaryButton
            label={recording ? 'Recording…' : 'Record'}
            onPress={() => void startRecording()}
            disabled={busy || recording}
            orange
            testID="stitch.record"
          />
          {recording && (
            <Card>
              <Text style={type.body}>
                Recording — {inbox.frames.length} frame
                {inbox.frames.length === 1 ? '' : 's'} so far.
              </Text>
              <Text style={[type.small, styles.spaced]}>
                Stop the recording when you reach the end; stitching starts
                by itself.
              </Text>
            </Card>
          )}
          {inbox.finished && inbox.frames.length > 0 && !busy && (
            <Card>
              <Text style={type.body}>
                Recording ready — {inbox.frames.length} frames.
              </Text>
              <View style={styles.rowGap}>
                <PrimaryButton
                  label={result && resultFrom === 'record' ? 'Stitch again' : 'Stitch the recording'}
                  onPress={() => void run(inbox.frames, 'record')}
                />
                <GhostButton label="Discard recording" onPress={discardRecording} />
              </View>
            </Card>
          )}
        </>
      )}

      {mode === 'photos' && (
        <>
          {shots.length > 0 && (
            <View style={styles.thumbs}>
              {shots.map((s, i) => (
                <View key={`${s.uri}-${i}`} style={styles.thumbWrap}>
                  <Image source={{ uri: s.uri }} style={styles.thumb} />
                  <Text style={styles.thumbIndex}>{i + 1}</Text>
                  <View style={styles.thumbActions}>
                    <Pressable accessibilityLabel="Move earlier" onPress={() => move(i, -1)} hitSlop={6}>
                      <Text style={styles.thumbBtn}>‹</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Remove"
                      onPress={() => setShots((all) => all.filter((_, j) => j !== i))}
                      hitSlop={6}
                    >
                      <Text style={styles.thumbBtn}>✕</Text>
                    </Pressable>
                    <Pressable accessibilityLabel="Move later" onPress={() => move(i, 1)} hitSlop={6}>
                      <Text style={styles.thumbBtn}>›</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
          <PrimaryButton
            label={shots.length ? 'Add more screenshots' : 'Add your screenshots'}
            onPress={pickShots}
          />
          {shots.length >= 2 && (
            <PrimaryButton
              label={busy ? 'Stitching…' : `Stitch ${shots.length} shots`}
              onPress={() => void run(shots, 'photos')}
              disabled={busy}
              orange
            />
          )}
          <Text style={type.small}>
            Pick screenshots top to bottom that overlap a little. Fixed bars
            (status, navigation, tab bar) are kept once. Use ‹ › to reorder.
          </Text>
        </>
      )}

      {!!progress && <Text style={[type.small, styles.progress]}>{progress}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <>
          <Card style={styles.resultCard}>
            <Text style={type.label}>Your long screenshot</Text>
            <Pressable onPress={() => setViewer(true)} accessibilityLabel="View full length">
              <SegmentsPreview result={result} maxHeight={440} />
            </Pressable>
            <Text style={[type.numSmall, styles.center]}>
              {result.width} × {result.height} px · {formatBytes(result.bytes)}
            </Text>
            {(result.duplicates > 0 || result.trimmed > 0) && (
              <Text style={[type.small, styles.center]}>
                {result.duplicates > 0 ? `${result.duplicates} unchanged frames skipped. ` : ''}
                {result.trimmed > 0 ? `${result.trimmed} frames at the start/end left out.` : ''}
              </Text>
            )}
            {result.stackedSeams > 0 && (
              <Text style={[type.small, styles.center]}>
                {result.stackedSeams} spot{result.stackedSeams === 1 ? '' : 's'} didn’t
                overlap (scrolled too fast) and {result.stackedSeams === 1 ? 'was' : 'were'} stacked in order.
              </Text>
            )}
            <GhostButton label="View full length" onPress={() => setViewer(true)} />
          </Card>
          <PrimaryButton label="Save to Photos" onPress={() => void save()} testID="stitch.save" />
          <GhostButton
            label="Share image"
            onPress={() =>
              void shareFile(result.uri, 'image/png').then((ok) => {
                if (!ok) setError('Sharing isn’t available here.');
              })
            }
          />
          {result.height <= COPY_MAX_HEIGHT && (
            <GhostButton label="Copy image" onPress={() => void copyImage()} />
          )}
          {resultFrom === 'session' && sessionAssets.length > 0 && (
            <GhostButton
              label={`Delete the ${sessionAssets.length} screenshots from Photos`}
              onPress={() => void deleteSources()}
            />
          )}
          <FullLengthViewer result={result} visible={viewer} onClose={() => setViewer(false)} />
        </>
      )}
    </ToolShell>
  );
}

/** Shows the stitch by drawing each source frame's used rows — exactly
 *  what was written, without decoding one giant bitmap. */
function SegmentView({
  frame,
  seg,
  scale,
}: {
  frame: { uri: string; width: number; height: number };
  seg: Segment;
  scale: number;
}) {
  return (
    <View style={{ height: (seg.to - seg.from) * scale, overflow: 'hidden' }}>
      <Image
        source={{ uri: frame.uri }}
        style={{
          width: frame.width * scale,
          height: frame.height * scale,
          marginTop: -seg.from * scale,
        }}
      />
    </View>
  );
}

function SegmentsPreview({ result, maxHeight }: { result: StitchResult; maxHeight: number }) {
  const [width, setWidth] = useState(0);
  const scale = width > 0 ? width / result.width : 0;
  const shown = useMemo(() => {
    const out: Segment[] = [];
    let h = 0;
    for (const seg of result.segments) {
      if (h >= maxHeight || scale === 0) break;
      out.push(seg);
      h += (seg.to - seg.from) * scale;
    }
    return out;
  }, [result, scale, maxHeight]);
  return (
    <View
      style={[styles.preview, { maxHeight }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {shown.map((seg, i) => (
        <SegmentView key={i} frame={result.frames[seg.frame]!} seg={seg} scale={scale} />
      ))}
    </View>
  );
}

function FullLengthViewer({
  result,
  visible,
  onClose,
}: {
  result: StitchResult;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const scale = width > 0 ? width / result.width : 0;
  const offsets = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const s of result.segments) {
      out.push(at);
      at += (s.to - s.from) * scale;
    }
    return out;
  }, [result, scale]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[styles.viewer, { paddingTop: insets.top }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={styles.viewerBar}>
          <Text style={styles.viewerTitle}>
            {result.width} × {result.height}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Text style={styles.viewerClose}>Done</Text>
          </Pressable>
        </View>
        {scale > 0 && (
          <FlatList
            data={result.segments}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <SegmentView frame={result.frames[item.frame]!} seg={item} scale={scale} />
            )}
            getItemLayout={(_, index) => {
              const s = result.segments[index]!;
              return { length: (s.to - s.from) * scale, offset: offsets[index] ?? 0, index };
            }}
            windowSize={5}
            initialNumToRender={4}
            maxToRenderPerBatch={3}
            removeClippedSubviews
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  spaced: { marginTop: 10 },
  rowGap: { marginTop: 10, gap: 4 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 72, alignItems: 'center', gap: 4 },
  thumb: { width: 72, height: 108, borderRadius: 10, backgroundColor: colors.border },
  thumbIndex: {
    position: 'absolute',
    top: 4,
    left: 4,
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  thumbActions: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  thumbBtn: { fontSize: 18, fontWeight: '700', color: colors.accent, paddingHorizontal: 4 },
  progress: { textAlign: 'center' },
  resultCard: { alignItems: 'stretch', gap: 10 },
  preview: { width: '100%', overflow: 'hidden', borderRadius: 10, backgroundColor: colors.border },
  center: { textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  viewerTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  viewerClose: { color: '#4DA3FF', fontSize: 17, fontWeight: '700' },
});
