import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { Card, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { formatBytes, saveToPhotos, shareFile } from '../lib/files';
import { makeGifFromVideo, type GifResult } from '../lib/gif';
import {
  clampGifRange,
  estimateGifBytes,
  formatGifTime,
  planGif,
} from '../lib/gifenc';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';

type GifAdjust = {
  start: number;
  length: number;
  fps: string;
  width: string;
  colour: 'best' | 'fast';
};

/**
 * Video to GIF. A playable preview loops the selected stretch. The
 * Photos-style bar trims it (0.5–10 s); the steppers nudge by a tenth.
 * Frames are raw RGBA, not PNG stills.
 */
export function GifScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const [video, setVideo] = useState<{
    uri: string;
    durationMs: number;
    width: number;
    height: number;
  } | null>(null);
  const [result, setResult] = useState<GifResult | null>(null);
  const adjust = useUndoHistory<GifAdjust>(
    { start: 0, length: 5, fps: '10', width: '360', colour: 'best' },
    { shake: true },
  );
  const { start, length, fps, width, colour } = adjust.present;
  const setTrim = (startSec: number, lengthSec: number, group = false) => {
    adjust.commit((current) => ({ ...current, start: startSec, length: lengthSec }), group);
  };
  const [playhead, setPlayhead] = useState(0);
  const [seek, setSeek] = useState<{ id: number; t: number } | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);
  const seekId = useRef(0);

  const durationSec = (video?.durationMs ?? 0) / 1000;
  const end = start + length;

  const forgetResult = () => {
    runId.current += 1;
    setResult(null);
    setBusy(false);
    setProgress(null);
  };

  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    const count = 10;
    const durMs = Math.max(1, video.durationMs);
    void (async () => {
      const next: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const at = Math.min(durMs - 1, Math.round(((i + 0.5) / count) * durMs));
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(video.uri, {
            time: Math.max(0, at),
            quality: 0.4,
          });
          next.push(thumb.uri);
        } catch {
          next.push('');
        }
        if (cancelled) return;
        setThumbs([...next]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [video]);

  const requestSeek = (t: number) => {
    seekId.current += 1;
    setPlayhead(t);
    setSeek({ id: seekId.current, t });
  };

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
    if (!a) return;
    const durationMs = a.duration && a.duration > 0 ? a.duration : 5000;
    const range = clampGifRange({
      durationSec: durationMs / 1000,
      startSec: 0,
      endSec: Math.min(5, durationMs / 1000),
      anchor: 'start',
    });
    forgetResult();
    setThumbs([]);
    setVideo({
      uri: a.uri,
      durationMs,
      width: a.width ?? 0,
      height: a.height ?? 0,
    });
    setTrim(range.startSec, range.lengthSec);
    setPlayhead(range.startSec);
    setSeek(null);
    setError(null);
  };

  const onTrim = (
    nextStart: number,
    nextEnd: number,
    nextPlay: number,
    anchor: 'start' | 'end' | 'window' | 'play',
  ) => {
    if (!video) return;
    if (anchor === 'play') {
      const t = Math.min(end, Math.max(start, nextPlay));
      requestSeek(t);
      return;
    }
    const range = clampGifRange({
      durationSec,
      startSec: nextStart,
      endSec: nextEnd,
      anchor,
    });
    forgetResult();
    setTrim(range.startSec, range.lengthSec, true);
    requestSeek(Math.min(range.endSec, Math.max(range.startSec, nextPlay)));
  };

  const nudgeStart = (next: number) => {
    const range = clampGifRange({
      durationSec,
      startSec: next,
      endSec: next + length,
      anchor: 'window',
    });
    forgetResult();
    setTrim(range.startSec, range.lengthSec);
    setPlayhead((p) => Math.min(range.endSec, Math.max(range.startSec, p)));
  };

  const nudgeLength = (next: number) => {
    const range = clampGifRange({
      durationSec,
      startSec: start,
      endSec: start + next,
      anchor: 'start',
    });
    forgetResult();
    setTrim(range.startSec, range.lengthSec);
    setPlayhead((p) => Math.min(range.endSec, Math.max(range.startSec, p)));
  };

  const run = async () => {
    if (!video) return;
    const id = ++runId.current;
    setBusy(true);
    setError(null);
    try {
      const out = await makeGifFromVideo(video.uri, {
        durationSec: video.durationMs / 1000,
        startSec: start,
        lengthSec: length,
        fps: Number(fps),
        width: Number(width),
        sourceWidth: video.width,
        sourceHeight: video.height,
        colour,
        onProgress: (done, total) => {
          if (id === runId.current) setProgress(`Frame ${done} of ${total}`);
        },
      });
      if (id !== runId.current) return;
      setResult(out);
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : 'That video couldn’t be read.');
    } finally {
      if (id === runId.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const save = async () => {
    if (!result) return;
    const problem = await saveToPhotos(result.uri);
    if (problem) setError(problem);
    else notify('Saved to Photos');
  };

  const plan = planGif({
    durationSec: durationSec > 0 ? durationSec : 0,
    startSec: start,
    lengthSec: length,
    fps: Number(fps),
  });
  const outW = Number(width);
  const outH =
    video && video.width > 0 && video.height > 0
      ? Math.max(1, Math.round(outW * (video.height / video.width)))
      : Math.max(1, Math.round((outW * 9) / 16));
  const estimate = estimateGifBytes({
    width: outW,
    height: outH,
    frames: plan.times.length,
    colour,
  });
  const thumbAt =
    durationSec > 0 && thumbs.length > 0
      ? Math.min(thumbs.length - 1, Math.floor((playhead / durationSec) * thumbs.length))
      : 0;
  const still = thumbs[thumbAt] || thumbs.find((uri) => uri.length > 0) || null;

  return (
    <ToolShell
      title="Video to GIF"
      onBack={onBack}
      undo={{
        canUndo: adjust.canUndo,
        canRedo: adjust.canRedo,
        onUndo: () => adjust.undo(),
        onRedo: () => adjust.redo(),
      }}
    >
      <Text style={type.small}>
        Drag the handles to choose up to 10 seconds. The preview loops that
        stretch. “Best colour” builds a palette from your clip.
      </Text>
      <PrimaryButton
        label={video ? 'Pick a different video' : 'Pick a video'}
        onPress={pick}
      />
      {video && (
        <>
          <RangePreview
            key={video.uri}
            uri={video.uri}
            start={start}
            end={end}
            seek={seek}
            fallbackUri={still}
            onTime={setPlayhead}
            onDuration={(seconds) => {
              if (seconds <= 0) return;
              const durationMs = Math.round(seconds * 1000);
              setVideo((current) => {
                if (!current || Math.abs(current.durationMs - durationMs) < 50) return current;
                return { ...current, durationMs };
              });
              const range = clampGifRange({
                durationSec: seconds,
                startSec: start,
                endSec: start + length,
                anchor: 'start',
              });
              if (range.startSec === start && range.lengthSec === length) return;
              forgetResult();
              setTrim(range.startSec, range.lengthSec);
            }}
          />
          <View style={styles.timeRow}>
            <Text style={type.small}>{formatGifTime(start)}</Text>
            <Text style={type.small}>{length.toFixed(1)} s</Text>
            <Text style={type.small}>{formatGifTime(end)}</Text>
          </View>
          <TrimBar
            duration={durationSec}
            start={start}
            end={end}
            playhead={playhead}
            thumbs={thumbs}
            onChange={onTrim}
          />
          <Text style={type.label}>Fine tune</Text>
          <Stepper label="Start at" value={start} onChange={nudgeStart} />
          <Stepper label="Length" value={length} onChange={nudgeLength} />
          <Text style={type.small}>
            {plan.times.length} frames · about {formatBytes(estimate)}
            {durationSec > 0 ? ` · clip is ${formatGifTime(durationSec)}` : ''}
          </Text>
          <Text style={type.label}>Smoothness</Text>
          <Segmented
            options={[
              { id: '6', label: '6 fps' },
              { id: '10', label: '10 fps' },
              { id: '15', label: '15 fps' },
            ]}
            value={fps}
            onChange={(next) => {
              forgetResult();
              adjust.commit((current) => ({ ...current, fps: next }));
            }}
          />
          <Text style={type.label}>Size</Text>
          <Segmented
            options={[
              { id: '240', label: 'Small' },
              { id: '360', label: 'Medium' },
              { id: '480', label: 'Large' },
            ]}
            value={width}
            onChange={(next) => {
              forgetResult();
              adjust.commit((current) => ({ ...current, width: next }));
            }}
          />
          <Segmented
            options={[
              { id: 'best', label: 'Best colour' },
              { id: 'fast', label: 'Fast' },
            ]}
            value={colour}
            onChange={(next) => {
              forgetResult();
              adjust.commit((current) => ({ ...current, colour: next }));
            }}
          />
        </>
      )}
      {video && (
        <PrimaryButton
          label={busy ? 'Making GIF…' : 'Make GIF'}
          onPress={run}
          disabled={busy}
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

function RangePreview({
  uri,
  start,
  end,
  seek,
  fallbackUri,
  onTime,
  onDuration,
}: {
  uri: string;
  start: number;
  end: number;
  seek: { id: number; t: number } | null;
  fallbackUri: string | null;
  onTime: (t: number) => void;
  onDuration: (seconds: number) => void;
}) {
  const [mod, setMod] = useState<typeof import('expo-video') | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    import('expo-video')
      .then((loaded) => {
        if (live) setMod(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (failed || !mod) {
    return <StillPreview uri={fallbackUri} />;
  }
  return (
    <PreviewBoundary fallback={<StillPreview uri={fallbackUri} />}>
      <RangePlayer
        mod={mod}
        uri={uri}
        start={start}
        end={end}
        seek={seek}
        onTime={onTime}
        onDuration={onDuration}
        onFail={() => setFailed(true)}
      />
    </PreviewBoundary>
  );
}

function RangePlayer({
  mod,
  uri,
  start,
  end,
  seek,
  onTime,
  onDuration,
  onFail,
}: {
  mod: typeof import('expo-video');
  uri: string;
  start: number;
  end: number;
  seek: { id: number; t: number } | null;
  onTime: (t: number) => void;
  onDuration: (seconds: number) => void;
  onFail: () => void;
}) {
  const { styles } = useThemed(makeStyles);
  const player = mod.useVideoPlayer(uri, (created) => {
    created.loop = false;
    created.timeUpdateEventInterval = 0.05;
    placePlayer(created, start, true);
  });
  const rangeRef = useRef({ start, end });
  const onTimeRef = useRef(onTime);
  const onDurationRef = useRef(onDuration);
  const onFailRef = useRef(onFail);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    rangeRef.current = { start, end };
    onTimeRef.current = onTime;
    onDurationRef.current = onDuration;
    onFailRef.current = onFail;
  }, [start, end, onTime, onDuration, onFail]);

  useEffect(() => {
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      const { start: s, end: e } = rangeRef.current;
      if (currentTime >= e - 0.03) {
        placePlayer(player, s, true);
        onTimeRef.current(s);
        return;
      }
      onTimeRef.current(currentTime);
    });
    const endSub = player.addListener('playToEnd', () => {
      placePlayer(player, rangeRef.current.start, true);
      onTimeRef.current(rangeRef.current.start);
    });
    const playSub = player.addListener('playingChange', ({ isPlaying }) => {
      setPlaying(isPlaying);
    });
    const loadSub = player.addListener('sourceLoad', ({ duration }) => {
      if (duration > 0) onDurationRef.current(duration);
    });
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onFailRef.current();
    });
    return () => {
      timeSub.remove();
      endSub.remove();
      playSub.remove();
      loadSub.remove();
      statusSub.remove();
    };
  }, [player]);

  useEffect(() => {
    const t = player.currentTime;
    if (t < start - 0.02 || t >= end - 0.02) placePlayer(player, start, false);
  }, [player, start, end]);

  useEffect(() => {
    if (!seek) return;
    placePlayer(player, seek.t, false);
  }, [player, seek]);

  const toggle = () => {
    if (player.playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.preview}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}
        onPress={toggle}
        style={styles.previewHit}
      >
        <mod.VideoView
          player={player}
          style={styles.previewVideo}
          nativeControls={false}
          contentFit="contain"
        />
      </Pressable>
      {!playing && (
        <View pointerEvents="none" style={styles.playBadge}>
          <Text style={styles.playBadgeText}>Play</Text>
        </View>
      )}
    </View>
  );
}

function StillPreview({ uri }: { uri: string | null }) {
  const { styles } = useThemed(makeStyles);
  return (
    <View style={styles.preview}>
      {uri ? <Image source={{ uri }} style={styles.previewVideo} resizeMode="contain" /> : null}
    </View>
  );
}

class PreviewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function TrimBar({
  duration,
  start,
  end,
  playhead,
  thumbs,
  onChange,
}: {
  duration: number;
  start: number;
  end: number;
  playhead: number;
  thumbs: string[];
  onChange: (
    start: number,
    end: number,
    playhead: number,
    anchor: 'start' | 'end' | 'window' | 'play',
  ) => void;
}) {
  const { styles } = useThemed(makeStyles);
  const [width, setWidth] = useState(1);
  const live = useRef({ duration, start, end, playhead, width, onChange });
  const drag = useRef<{
    mode: 'start' | 'end' | 'window' | 'play';
    start: number;
    end: number;
    playhead: number;
    x: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    live.current = { duration, start, end, playhead, width, onChange };
  }, [duration, start, end, playhead, width, onChange]);

  const onGrant = (e: GestureResponderEvent) => {
    const box = live.current;
    const x = e.nativeEvent.locationX;
    const sx = box.duration > 0 ? (box.start / box.duration) * box.width : 0;
    const ex = box.duration > 0 ? (box.end / box.duration) * box.width : box.width;
    const mode =
      Math.abs(x - sx) <= 28 ? 'start' : Math.abs(x - ex) <= 28 ? 'end' : x > sx && x < ex ? 'window' : 'play';
    drag.current = {
      mode,
      start: box.start,
      end: box.end,
      playhead: box.playhead,
      x,
      width: box.width,
    };
  };

  const onMove = (e: GestureResponderEvent) => {
    const box = live.current;
    const origin = drag.current;
    if (!origin || origin.width <= 0 || box.duration <= 0) return;
    const delta = ((e.nativeEvent.locationX - origin.x) / origin.width) * box.duration;
    if (origin.mode === 'start') {
      box.onChange(origin.start + delta, origin.end, origin.playhead, 'start');
    } else if (origin.mode === 'end') {
      box.onChange(origin.start, origin.end + delta, origin.playhead, 'end');
    } else if (origin.mode === 'window') {
      box.onChange(origin.start + delta, origin.end + delta, origin.playhead + delta, 'window');
    } else {
      const t = Math.min(origin.end, Math.max(origin.start, origin.playhead + delta));
      box.onChange(origin.start, origin.end, t, 'play');
    }
  };

  const d = duration > 0 ? duration : 1;
  const startX = (start / d) * width;
  const endX = (end / d) * width;
  const playX = (Math.min(end, Math.max(start, playhead)) / d) * width;

  return (
    <View
      accessibilityLabel="Trim bar"
      style={styles.trim}
      onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onStartShouldSetResponderCapture={() => true}
      onMoveShouldSetResponder={() => true}
      onMoveShouldSetResponderCapture={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={() => {
        drag.current = null;
      }}
    >
      <View style={styles.film} pointerEvents="none">
        {thumbs.length === 0 ? (
          <View style={styles.thumb} />
        ) : (
          thumbs.map((uri, i) =>
            uri ? (
              <Image key={`${uri}-${i}`} source={{ uri }} style={styles.thumb} />
            ) : (
              <View key={`empty-${i}`} style={styles.thumb} />
            ),
          )
        )}
      </View>
      <View pointerEvents="none" style={[styles.dim, { width: Math.max(0, startX) }]} />
      <View pointerEvents="none" style={[styles.dim, { left: endX, right: 0 }]} />
      <View
        pointerEvents="none"
        style={[styles.selection, { left: startX, width: Math.max(2, endX - startX) }]}
      />
      <View pointerEvents="none" style={[styles.handle, { left: startX - 8 }]}>
        <View style={styles.grip} />
      </View>
      <View pointerEvents="none" style={[styles.handle, { left: endX - 8 }]}>
        <View style={styles.grip} />
      </View>
      <View pointerEvents="none" style={[styles.playhead, { left: playX - 1 }]} />
    </View>
  );
}

/** expo-video hands back a mutable player. Seeking and play are its API. */
function placePlayer(
  player: { currentTime: number; play: () => void },
  time: number,
  play: boolean,
) {
  player.currentTime = time;
  if (play) player.play();
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const shown = (Math.round(value * 10) / 10).toFixed(1);
  const step = (dir: number) => onChange(Math.round((value + dir * 0.1) * 10) / 10);
  return (
    <View style={styles.stepper}>
      <Text style={type.body}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable accessibilityLabel={`${label} less`} onPress={() => step(-1)} hitSlop={8}>
          <Text style={styles.stepBtn}>−</Text>
        </Pressable>
        <Text style={type.numSmall}>{shown} s</Text>
        <Pressable accessibilityLabel={`${label} more`} onPress={() => step(1)} hitSlop={8}>
          <Text style={styles.stepBtn}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    preview: {
      height: 240,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: p.media,
    },
    previewHit: { flex: 1 },
    previewVideo: { width: '100%', height: '100%' },
    playBadge: {
      position: 'absolute',
      top: 100,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    playBadgeText: {
      color: p.onMedia,
      fontSize: 15,
      fontWeight: '700',
      backgroundColor: p.scrim,
      borderRadius: 16,
      overflow: 'hidden',
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
    trim: {
      height: 64,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: p.mediaRaised,
    },
    film: { flex: 1, flexDirection: 'row' },
    thumb: { flex: 1, height: 64, backgroundColor: p.mediaTrack },
    dim: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: p.scrim,
    },
    selection: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderTopWidth: 3,
      borderBottomWidth: 3,
      borderColor: p.onMedia,
    },
    handle: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 16,
      backgroundColor: p.onMedia,
      alignItems: 'center',
      justifyContent: 'center',
    },
    grip: { width: 2, height: 22, borderRadius: 1, backgroundColor: p.mediaRaised },
    playhead: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 2,
      backgroundColor: p.onMedia,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: p.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    stepBtn: { fontSize: 26, fontWeight: '700', color: p.primary, paddingHorizontal: 6 },
    resultCard: { gap: 12, alignItems: 'stretch' },
    gif: { width: '100%', height: 240, borderRadius: 10, backgroundColor: p.media },
    center: { textAlign: 'center' },
    error: { color: p.destructive, fontSize: 15 },
  });
}
