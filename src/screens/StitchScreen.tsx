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
  type GestureResponderEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
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
  renderStitch,
  stitchFrames,
  type Redaction,
  type ShotInput,
  type StitchPhase,
  type StitchResult,
} from '../lib/stitch';
import { overlapWarning, type ColumnRepair, type OverlayStamp, type Segment } from '../lib/stitchCore';
import { previewSpan } from '../lib/stitchMath';
import {
  requestNotificationPermission,
  sharedVaultAvailable,
  showBroadcastPicker,
} from '../store/sharedVault';
import { dark, type Palette } from '../theme';
import { useThemed } from '../useTheme';

type Notify = (msg: string, action?: { label: string; onPress: () => void }) => void;

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
  notify: Notify;
}) {
  const { type, styles } = useThemed(makeStyles);
  const [mode, setMode] = useState<Mode>(initialShots?.length ? 'photos' : 'session');
  const [sessionAt, setSessionAt] = useState<number | null>(() => sessionStart());
  const [sessionCount, setSessionCount] = useState(0);
  const [photoAccess, setPhotoAccess] = useState<PhotoAccess | null>(null);
  const [sessionAssets, setSessionAssets] = useState<string[]>([]);
  const shotsHist = useUndoHistory<ShotInput[]>(initialShots ?? [], { shake: true });
  const shots = shotsHist.present;
  const [result, setResult] = useState<StitchResult | null>(null);
  const [resultFrom, setResultFrom] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inbox, setInbox] = useState<BroadcastInbox>({ frames: [], finished: false });
  const [viewer, setViewer] = useState(false);
  const autoStitched = useRef<string | null>(null);
  const busyRef = useRef(false);
  /** Latest committed image. Updated synchronously, not on the next render,
   *  so Save cannot read a pre-redaction URI that setState has not flushed. */
  const resultRef = useRef<StitchResult | null>(null);
  /** In-flight "Hide details" rewrite. Save waits for it. */
  const pendingRender = useRef<Promise<void> | null>(null);

  const commitResult = useCallback((next: StitchResult | null) => {
    resultRef.current = next;
    setResult(next);
  }, []);

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
      commitResult(null);
      try {
        const out = await stitchFrames(inputs, {
          mode: from === 'record' ? 'record' : 'photos',
          onProgress,
        });
        commitResult(out);
        setResultFrom(from);
        if (out.gaps.length === 1) {
          const g = out.gaps[0]!;
          notify(overlapWarning(g.first, g.second));
        } else if (out.gaps.length > 1) {
          notify(
            `${out.gaps.length} joins don’t overlap — retake those with a bit less scroll`,
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
    [commitResult, notify, onProgress],
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
    commitResult(null);
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
    shotsHist.commit((s) => [...s, ...picked]);
    commitResult(null);
    setError(null);
  };

  const move = (index: number, dir: -1 | 1) => {
    shotsHist.commit((all) => {
      const j = index + dir;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      const [item] = next.splice(index, 1);
      if (item) next.splice(j, 0, item);
      return next;
    });
  };

  const save = async () => {
    const pending = pendingRender.current;
    if (pending) await pending;
    const current = resultRef.current;
    if (!current) return;
    // Snapshot after the redaction render has committed. PhotoKit must
    // receive that file, not the image from before Hide details.
    const uri = current.uri;
    const problem = await saveToPhotos(uri);
    if (problem) setError(problem);
    else notify('Saved to Photos');
  };

  const copyImage = async () => {
    const pending = pendingRender.current;
    if (pending) await pending;
    const current = resultRef.current;
    if (!current) return;
    try {
      const b64 = await new File(current.uri).base64();
      await Clipboard.setImageAsync(b64);
      notify('Copied');
    } catch {
      setError('Couldn’t copy this image — use Share instead.');
    }
  };

  const applyRedactions = useCallback(
    async (rects: Redaction[]): Promise<boolean> => {
      const base = resultRef.current;
      if (!base || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      const job = (async (): Promise<boolean> => {
        try {
          const next = await renderStitch(base, rects, onProgress);
          commitResult(next);
          notify(
            rects.length
              ? `Hid ${rects.length} area${rects.length === 1 ? '' : 's'}`
              : 'All areas shown again',
          );
          return true;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Couldn’t update the image.');
          return false;
        } finally {
          busyRef.current = false;
          setBusy(false);
          setProgress(null);
        }
      })();
      const gate = job.then(
        () => undefined,
        () => undefined,
      );
      pendingRender.current = gate;
      try {
        return await job;
      } finally {
        if (pendingRender.current === gate) pendingRender.current = null;
      }
    },
    [commitResult, notify, onProgress],
  );

  const discardRecording = () => {
    clearBroadcastInbox();
    setInbox({ frames: [], finished: false });
    if (resultFrom === 'record') commitResult(null);
    notify('Recording discarded');
  };

  const recording = inbox.frames.length > 0 && !inbox.finished;

  return (
    <ToolShell
      title="Long screenshot"
      onBack={onBack}
      undo={{
        canUndo: shotsHist.canUndo,
        canRedo: shotsHist.canRedo,
        onUndo: () => shotsHist.undo(),
        onRedo: () => shotsHist.redo(),
      }}
    >
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
              2. In any app, take a screenshot (side button + volume up).
              Scroll a bit less than a full screen, so part of the last
              shot is still showing, then take another — as many as you
              like.{'\n'}
              3. Come back and tap Stitch. Everytool joins every screenshot
              taken since Start into one long image.
            </Text>
            <Text style={[type.small, styles.spaced]}>
              Tip: Scroll a bit less than a full screen each time, so part of
              the last shot is still showing. Settings → Accessibility →
              Touch → Back Tap → Double Tap, then choose Screenshot. iOS
              saves each shot to Photos automatically. Come back and tap
              Stitch. You can also add “Start Long Screenshot” and “Stitch
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
                      onPress={() => {
                        shotsHist.commit((all) => all.filter((_, j) => j !== i));
                        notify('Removed', { label: 'Undo', onPress: () => shotsHist.undo() });
                      }}
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
            />
          )}
          <Text style={type.small}>
            Scroll a bit less than a full screen between shots, so part of
            the last one is still showing. Fixed bars (status, navigation,
            tab bar) are kept once. Use ‹ › to reorder.
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
            {result.gaps.slice(0, 6).map((g) => (
              <Text key={`${g.first}-${g.second}`} style={styles.warning}>
                {overlapWarning(g.first, g.second)}
              </Text>
            ))}
            {result.gaps.length > 6 && (
              <Text style={styles.warning}>
                And {result.gaps.length - 6} more — retake those with a bit less scroll.
              </Text>
            )}
            <GhostButton label="View full length" onPress={() => setViewer(true)} />
          </Card>
          <PrimaryButton label="Save to Photos" onPress={() => void save()} testID="stitch.save" />
          <GhostButton
            label="Share image"
            onPress={() => {
              void (async () => {
                const pending = pendingRender.current;
                if (pending) await pending;
                const current = resultRef.current;
                if (!current) return;
                const ok = await shareFile(current.uri, 'image/png');
                if (!ok) setError('Sharing isn’t available here.');
              })();
            }}
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
          <FullLengthViewer
            key={result.uri}
            result={result}
            visible={viewer}
            onClose={() => setViewer(false)}
            busy={busy}
            onApply={applyRedactions}
          />
        </>
      )}
    </ToolShell>
  );
}

/** Shows the stitch by drawing each source frame's used rows — exactly
 *  what was written, without decoding one giant bitmap. Repairs and the
 *  one floating-overlay stamp are drawn on top of those rows. */
function SegmentView({
  frame,
  seg,
  scale,
  outY,
  frames,
  repairs,
  stamps,
}: {
  frame: { uri: string; width: number; height: number };
  seg: Segment;
  scale: number;
  outY: number;
  frames: { uri: string; width: number; height: number }[];
  repairs: ColumnRepair[];
  stamps: OverlayStamp[];
}) {
  const segH = seg.to - seg.from;
  const viewH = previewSpan(seg.from, seg.to, scale);
  const localRepairs = repairs.filter((r) => r.outY1 > outY && r.outY0 < outY + segH);
  const localStamps = stamps.filter((s) => s.outY + s.height > outY && s.outY < outY + segH);
  if (viewH <= 0) return null;
  const px = (n: number) => Math.round(n * scale);
  return (
    <View style={{ height: viewH, overflow: 'hidden' }}>
      <Image
        source={{ uri: frame.uri }}
        resizeMode="stretch"
        style={{
          width: px(frame.width),
          height: px(frame.height),
          marginTop: -px(seg.from),
        }}
      />
      {localRepairs.map((r, i) => {
        const donor = frames[r.frame];
        if (!donor || scale === 0) return null;
        const visTop = Math.max(r.outY0, outY);
        const visBot = Math.min(r.outY1, outY + segH);
        const srcTop = r.srcY0 + (visTop - r.outY0);
        return (
          <View
            key={`r${i}`}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: px(r.x0),
              top: px(seg.from + (visTop - outY)) - px(seg.from),
              width: Math.max(1, px(r.x1) - px(r.x0)),
              height: Math.max(1, px(srcTop + (visBot - visTop)) - px(srcTop)),
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: donor.uri }}
              resizeMode="stretch"
              style={{
                width: px(donor.width),
                height: px(donor.height),
                marginTop: -px(srcTop),
                marginLeft: -px(r.x0),
              }}
            />
          </View>
        );
      })}
      {localStamps.map((s, i) => {
        const src = frames[s.frame];
        if (!src || scale === 0) return null;
        const visTop = Math.max(s.outY, outY);
        const visBot = Math.min(s.outY + s.height, outY + segH);
        const srcTop = s.srcY + (visTop - s.outY);
        return (
          <View
            key={`s${i}`}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: px(s.outX),
              top: px(seg.from + (visTop - outY)) - px(seg.from),
              width: Math.max(1, px(s.outX + s.width) - px(s.outX)),
              height: Math.max(1, px(srcTop + (visBot - visTop)) - px(srcTop)),
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: src.uri }}
              resizeMode="stretch"
              style={{
                width: px(src.width),
                height: px(src.height),
                marginTop: -px(srcTop),
                marginLeft: -px(s.srcX),
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

function SegmentsPreview({ result, maxHeight }: { result: StitchResult; maxHeight: number }) {
  const { styles } = useThemed(makeStyles);
  const [width, setWidth] = useState(0);
  const scale = width > 0 ? width / result.width : 0;
  const shown = useMemo(() => {
    const out: { seg: Segment; outY: number }[] = [];
    let h = 0;
    let outY = 0;
    for (const seg of result.segments) {
      if (h < maxHeight && scale !== 0) out.push({ seg, outY });
      h += previewSpan(seg.from, seg.to, scale);
      outY += seg.to - seg.from;
    }
    return out;
  }, [result, scale, maxHeight]);
  return (
    <View
      style={[styles.preview, { maxHeight }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {shown.map(({ seg, outY }, i) => (
        <SegmentView
          key={i}
          frame={result.frames[seg.frame]!}
          seg={seg}
          scale={scale}
          outY={outY}
          frames={result.frames}
          repairs={result.repairs}
          stamps={result.stamps}
        />
      ))}
      {result.redactions.map((r, i) => (
        <HiddenBox key={i} r={r} scale={scale} offset={0} />
      ))}
    </View>
  );
}

/** How a hidden area looks in previews (the saved image is pixelated). */
function HiddenBox({
  r,
  scale,
  offset,
  pending,
  night,
}: {
  r: Redaction;
  scale: number;
  offset: number;
  pending?: boolean;
  night?: boolean;
}) {
  const { styles } = useThemed(makeStyles, night ? dark : undefined);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.hidden,
        pending && styles.hiddenPending,
        {
          left: r.x * scale,
          top: r.y * scale - offset,
          width: r.width * scale,
          height: r.height * scale,
        },
      ]}
    />
  );
}

function FullLengthViewer({
  result,
  visible,
  onClose,
  onApply,
  busy,
}: {
  result: StitchResult;
  visible: boolean;
  onClose: () => void;
  onApply: (rects: Redaction[]) => Promise<boolean>;
  busy: boolean;
}) {
  const { styles } = useThemed(makeStyles, dark);
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [hiding, setHiding] = useState(false);
  const boxes = useUndoHistory<Redaction[]>(result.redactions);
  const rects = boxes.present;
  const [draft, setDraft] = useState<Redaction | null>(null);
  const scrollY = useRef(0);
  const [scrollShown, setScrollShown] = useState(0);
  const scale = width > 0 ? width / result.width : 0;
  const offsets = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const s of result.segments) {
      out.push(at);
      at += previewSpan(s.from, s.to, scale);
    }
    return out;
  }, [result, scale]);
  const outYs = useMemo(() => {
    const ys: number[] = [];
    let y = 0;
    for (const s of result.segments) {
      ys.push(y);
      y += s.to - s.from;
    }
    return ys;
  }, [result.segments]);

  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const toImage = (x: number, y: number) => ({
    x: Math.max(0, Math.min(result.width, x / scaleRef.current)),
    y: Math.max(0, Math.min(result.height, (y + scrollY.current) / scaleRef.current)),
  });
  const onGrant = (e: GestureResponderEvent) => {
    startRef.current = toImage(e.nativeEvent.locationX, e.nativeEvent.locationY);
  };
  const onMove = (e: GestureResponderEvent) => {
    const a = startRef.current;
    if (!a) return;
    const b = toImage(e.nativeEvent.locationX, e.nativeEvent.locationY);
    setDraft({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    });
  };
  const onRelease = () => {
    setDraft((d) => {
      if (d && d.width * scaleRef.current > 12 && d.height * scaleRef.current > 8) {
        boxes.commit((all) => [...all, d]);
      }
      return null;
    });
    startRef.current = null;
  };

  const changed = JSON.stringify(rects) !== JSON.stringify(result.redactions);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.viewer, { paddingTop: insets.top }]}>
        <View style={styles.viewerBar}>
          <Text style={styles.viewerTitle}>
            {hiding ? 'Drag over anything private' : `${result.width} × ${result.height}`}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Text style={styles.viewerClose}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.flex} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {scale > 0 && (
            <FlatList
              data={result.segments}
              keyExtractor={(_, i) => String(i)}
              scrollEnabled={!hiding}
              onScroll={(e) => {
                scrollY.current = e.nativeEvent.contentOffset.y;
                setScrollShown(scrollY.current);
              }}
              scrollEventThrottle={32}
              renderItem={({ item, index }) => (
                <SegmentView
                  frame={result.frames[item.frame]!}
                  seg={item}
                  scale={scale}
                  outY={outYs[index] ?? 0}
                  frames={result.frames}
                  repairs={result.repairs}
                  stamps={result.stamps}
                />
              )}
              getItemLayout={(_, index) => {
                const s = result.segments[index]!;
                return {
                  length: previewSpan(s.from, s.to, scale),
                  offset: offsets[index] ?? 0,
                  index,
                };
              }}
              windowSize={5}
              initialNumToRender={4}
              maxToRenderPerBatch={3}
              removeClippedSubviews={false}
            />
          )}
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents={hiding ? 'auto' : 'none'}
            onStartShouldSetResponder={() => hiding}
            onMoveShouldSetResponder={() => hiding}
            onResponderGrant={onGrant}
            onResponderMove={onMove}
            onResponderRelease={onRelease}
            onResponderTerminate={onRelease}
          >
            {rects.map((r, i) => (
              <HiddenBox key={i} r={r} scale={scale} offset={scrollShown} night />
            ))}
            {draft && <HiddenBox r={draft} scale={scale} offset={scrollShown} pending night />}
          </View>
        </View>
        <View style={[styles.viewerTools, { paddingBottom: insets.bottom + 8 }]}>
          {hiding ? (
            <>
              <Pressable onPress={() => boxes.undo()} disabled={!boxes.canUndo} hitSlop={8}>
                <Text style={[styles.toolText, !boxes.canUndo && styles.toolOff]}>Undo</Text>
              </Pressable>
              <Pressable onPress={() => boxes.redo()} disabled={!boxes.canRedo} hitSlop={8}>
                <Text style={[styles.toolText, !boxes.canRedo && styles.toolOff]}>Redo</Text>
              </Pressable>
              <Pressable onPress={() => setHiding(false)} hitSlop={8}>
                <Text style={styles.toolText}>Scroll</Text>
              </Pressable>
              <Pressable
                disabled={busy || !changed}
                onPress={() => {
                  // Stay in hiding mode until the redacted file is committed.
                  // "Hide details" is the signal that Apply finished; leaving
                  // early let Save run against the unredacted image and let
                  // the later "Hid N areas" toast replace "Saved to Photos".
                  void (async () => {
                    const ok = await onApply(rects);
                    if (ok) setHiding(false);
                  })();
                }}
                hitSlop={8}
              >
                <Text style={[styles.toolText, styles.toolPrimary, (busy || !changed) && { opacity: 0.4 }]}>
                  {busy ? 'Saving…' : 'Apply'}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => setHiding(true)} hitSlop={8} accessibilityLabel="Hide details">
                <Text style={styles.toolText}>Hide details</Text>
              </Pressable>
              {rects.length > 0 && (
                <Text style={styles.toolNote}>
                  {rects.length} hidden{changed ? ' · not applied yet' : ''}
                </Text>
              )}
              {changed && (
                <Pressable disabled={busy} onPress={() => void onApply(rects)} hitSlop={8}>
                  <Text style={[styles.toolText, styles.toolPrimary]}>{busy ? 'Saving…' : 'Apply'}</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    spaced: { marginTop: 10 },
    rowGap: { marginTop: 10, gap: 4 },
    thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    thumbWrap: { width: 72, alignItems: 'center', gap: 4 },
    thumb: { width: 72, height: 108, borderRadius: 10, backgroundColor: p.mediaTrack },
    thumbIndex: {
      position: 'absolute',
      top: 4,
      left: 4,
      fontSize: 12,
      fontWeight: '800',
      color: p.onMedia,
      backgroundColor: p.scrim,
      borderRadius: 6,
      paddingHorizontal: 5,
      overflow: 'hidden',
    },
    thumbActions: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
    thumbBtn: { fontSize: 18, fontWeight: '700', color: p.primary, paddingHorizontal: 4 },
    progress: { textAlign: 'center' },
    resultCard: { alignItems: 'stretch', gap: 10 },
    preview: { width: '100%', overflow: 'hidden', borderRadius: 10, backgroundColor: p.surface },
    center: { textAlign: 'center' },
    warning: { color: p.warning, fontSize: 15, textAlign: 'center' },
    error: { color: p.destructive, fontSize: 15 },
    viewer: { flex: 1, backgroundColor: p.media },
    viewerBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    viewerTitle: { color: p.onMedia, fontSize: 15, fontWeight: '600' },
    viewerClose: { color: p.primary, fontSize: 17, fontWeight: '700' },
    flex: { flex: 1 },
    viewerTools: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 12,
      backgroundColor: p.mediaRaised,
    },
    toolText: { color: p.onMedia, fontSize: 17, fontWeight: '600' },
    toolPrimary: { color: p.primary, fontWeight: '800' },
    toolOff: { opacity: 0.35 },
    toolNote: { color: p.textSecondary, fontSize: 14 },
    hidden: {
      position: 'absolute',
      backgroundColor: p.hideFill,
      borderRadius: 3,
    },
    hiddenPending: { backgroundColor: p.primaryWash, borderWidth: 2, borderColor: p.primary },
  });
}
