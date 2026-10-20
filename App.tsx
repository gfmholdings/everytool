import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState as RNAppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { File } from 'expo-file-system';

import { ToolGlyph } from './src/components/ui';
import { drainShareInbox, readBroadcastInbox } from './src/lib/incoming';
import type { ShotInput } from './src/lib/stitch';
import { ClipboardScreen } from './src/screens/ClipboardScreen';
import { ConvertScreen } from './src/screens/ConvertScreen';
import { DaysScreen } from './src/screens/DaysScreen';
import { GifScreen } from './src/screens/GifScreen';
import { PdfScreen } from './src/screens/PdfScreen';
import { QrScreen } from './src/screens/QrScreen';
import { ResizeScreen } from './src/screens/ResizeScreen';
import { SplitScreen } from './src/screens/SplitScreen';
import { StitchScreen } from './src/screens/StitchScreen';
import { TextScreen } from './src/screens/TextScreen';
import { AppStoreProvider, useStore } from './src/store/AppStore';
import { takePendingTool } from './src/store/sharedVault';
import { colors, space, type } from './src/theme';
import { TOOLS, type ToolId } from './src/types';

interface Pending {
  tool: ToolId;
  image?: { uri: string; width: number; height: number };
  pdf?: { uri: string; name: string };
  stitchShots?: ShotInput[];
  text?: string;
  autoRecord?: boolean;
  finishSession?: boolean;
  /** Changes on every "record" request so a mounted screen reacts too. */
  recordNonce?: number;
}

/** Tool ids arriving from controls / links: "<tool>" or "stitch:record". */
function parseToolRef(
  ref: string | null | undefined,
): { id: ToolId; record: boolean; session: boolean } | null {
  if (!ref) return null;
  const clean = ref.replace(/^\/+|\/+$/g, '');
  if (clean === 'record' || clean === 'stitch:record' || clean === 'stitch/record') {
    return { id: 'stitch', record: true, session: false };
  }
  if (clean === 'session' || clean === 'stitch:session' || clean === 'stitch/session') {
    return { id: 'stitch', record: false, session: true };
  }
  const id = clean as ToolId;
  return TOOLS.some((t) => t.id === id) ? { id, record: false, session: false } : null;
}

function requestFor(target: { record: boolean; session: boolean }) {
  if (target.record) return { autoRecord: true };
  if (target.session) return { finishSession: true };
  return undefined;
}

function Root() {
  const insets = useSafeAreaInsets();
  const { ready, addClip } = useStore();
  const [tool, setTool] = useState<ToolId | null>(null);
  const toolRef = useRef<ToolId | null>(null);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastAnim] = useState(() => new Animated.Value(0));
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback(
    (msg: string) => {
      setToast(msg);
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 2200);
    },
    [toastAnim],
  );

  const openTool = useCallback((id: ToolId, p?: Omit<Pending, 'tool'>) => {
    setPending(p ? { tool: id, ...p, recordNonce: Date.now() } : null);
    setTool(id);
  }, []);

  // Files shared into Everytool land in the App Group's ShareInbox; route
  // them to the tool picked in the share sheet. Runs at launch, on every
  // activation and on every deep link — the share extension opens the
  // app with everytool://tool/<id> while it may already be running.
  const draining = useRef(false);
  const drainAndRoute = useCallback(async (): Promise<boolean> => {
    if (draining.current) return false;
    draining.current = true;
    try {
      const items = await drainShareInbox();
      const first = items[0];
      if (!first) return false;
      const { item, uri } = first;
      if (item.kind === 'text') {
        let saved = 0;
        for (const x of items.filter((i) => i.item.kind === 'text')) {
          try {
            const text = await new File(x.uri).text();
            if (addClip(text)) saved += 1;
          } catch {
            // unreadable item: skip it
          }
        }
        if (saved > 0) notify(saved === 1 ? 'Saved to clipboard history' : `Saved ${saved} clips`);
        openTool('clipboard');
        return true;
      }
      if (item.kind === 'pdf') {
        openTool('pdf', { pdf: { uri, name: item.file } });
      } else if (item.tool === 'stitch') {
        openTool('stitch', {
          stitchShots: items
            .filter((x) => x.item.kind === 'image')
            .map((x) => ({ uri: x.uri, width: 0, height: 0 })),
        });
      } else if (item.tool === 'convert') {
        openTool('convert', { image: { uri, width: 0, height: 0 } });
      } else if (item.tool === 'resize') {
        openTool('resize', { image: { uri, width: 0, height: 0 } });
      } else if (item.tool === 'qr') {
        openTool('qr', { image: { uri, width: 0, height: 0 } });
      } else {
        openTool(item.tool);
      }
      return true;
    } finally {
      draining.current = false;
    }
  }, [addClip, notify, openTool]);

  // A finished screen recording waiting in the App Group opens the
  // stitcher (e.g. after tapping the "ready" notification).
  const checkRecording = useCallback(async () => {
    if (toolRef.current === 'stitch') return;
    const inbox = await readBroadcastInbox();
    if (inbox.finished && inbox.frames.length > 0) openTool('stitch');
  }, [openTool]);

  // Deep links: everytool://tool/<id> (Control Center, share sheet,
  // notifications) and everytool://stitch for finished recordings.
  useEffect(() => {
    if (!ready) return;
    const handle = (url: string | null) => {
      if (!url) return;
      const parsed = Linking.parse(url);
      const path = (parsed.path ?? '').replace(/^\//, '');
      let ref: string | null = null;
      if (parsed.hostname === 'tool') ref = path;
      else if (path.startsWith('tool/')) ref = path.slice('tool/'.length);
      else if (parsed.hostname === 'stitch' || path === 'stitch') ref = 'stitch';
      else if (parsed.hostname === 'record' || path === 'record') ref = 'record';
      else if (parsed.hostname === 'session' || path === 'session') ref = 'session';
      void drainAndRoute().then((routed) => {
        if (routed) return;
        const target = parseToolRef(ref);
        if (target) openTool(target.id, requestFor(target));
      });
    };
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    void Linking.getInitialURL().then(handle);
    return () => sub.remove();
  }, [ready, openTool, drainAndRoute]);

  // Control Center controls record their tool in the App Group; consume
  // it whenever the app activates. The intent's perform() can land just
  // after the activation event fires, so each activation checks now and
  // again at ~250ms and ~700ms — takePendingTool clears the key when it
  // reads it, so the repeats are no-ops once the tool is consumed.
  useEffect(() => {
    if (!ready) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const check = () => {
      const target = parseToolRef(takePendingTool());
      if (target) openTool(target.id, requestFor(target));
    };
    const onActive = () => {
      check();
      timers.push(setTimeout(check, 250));
      timers.push(setTimeout(check, 700));
      void drainAndRoute().then((routed) => {
        if (!routed) void checkRecording();
      });
    };
    onActive();
    const sub = RNAppState.addEventListener('change', (st) => {
      if (st === 'active') onActive();
    });
    return () => {
      sub.remove();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [ready, openTool, drainAndRoute, checkRecording]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Everytool</Text>
      </View>
    );
  }

  const back = () => {
    setTool(null);
    setPending(null);
  };

  let screen: React.ReactNode = null;
  switch (tool) {
    case 'stitch':
      screen = (
        <StitchScreen
          onBack={back}
          initialShots={pending?.stitchShots}
          recordRequest={pending?.autoRecord ? pending.recordNonce : undefined}
          sessionRequest={pending?.finishSession ? pending.recordNonce : undefined}
          notify={notify}
        />
      );
      break;
    case 'clipboard':
      screen = <ClipboardScreen onBack={back} notify={notify} />;
      break;
    case 'convert':
      screen = (
        <ConvertScreen
          onBack={back}
          initialSource={pending?.image}
          notify={notify}
        />
      );
      break;
    case 'qr':
      screen = <QrScreen onBack={back} notify={notify} initialImage={pending?.image?.uri} />;
      break;
    case 'resize':
      screen = (
        <ResizeScreen
          onBack={back}
          initialSource={pending?.image}
          notify={notify}
        />
      );
      break;
    case 'pdf':
      screen = <PdfScreen onBack={back} initialPdf={pending?.pdf} notify={notify} />;
      break;
    case 'text':
      screen = <TextScreen onBack={back} notify={notify} />;
      break;
    case 'days':
      screen = <DaysScreen onBack={back} notify={notify} />;
      break;
    case 'split':
      screen = <SplitScreen onBack={back} />;
      break;
    case 'gif':
      screen = <GifScreen onBack={back} notify={notify} />;
      break;
    default:
      screen = null;
  }

  return (
    <View style={styles.root}>
      {screen ?? (
        <ScrollView
          contentContainerStyle={[
            styles.home,
            { paddingTop: insets.top + 24 },
          ]}
        >
          <Text style={type.h1}>Everytool</Text>
          <Text style={[type.small, styles.intro]}>
            The small tools your phone is missing. Everything happens on
            this phone — no account, no uploads.
          </Text>
          <View style={styles.grid}>
            {TOOLS.map((t) => (
              <Pressable
                key={t.id}
                accessibilityLabel={`Open ${t.name}`}
                onPress={() => openTool(t.id)}
                style={({ pressed }) => [
                  styles.tile,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={styles.tileGlyph}>
                  <ToolGlyph id={t.id} size={24} />
                </View>
                <Text style={styles.tileName}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.surfacesCard}>
            <Text style={type.h2}>Everywhere you are</Text>
            <Text style={[type.body, styles.spaced]}>
              Your clipboard lives in the Everytool keyboard too — paste,
              copy, cut, save and edit clips in any app. Add it in Settings
              → General → Keyboard → Keyboards, turn on Allow Full Access,
              then hold the globe key.
            </Text>
            <Text style={[type.body, styles.spaced]}>
              Every tool can go in Control Center — plus Start Long
              Screenshot and Stitch Screenshots, so you can capture a long
              page from any app: swipe down, tap +, Add a Control, search
              “Everytool”.
            </Text>
          </View>
        </ScrollView>
      )}
      {toast && (
        <Animated.View style={[styles.toast, { opacity: toastAnim }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStoreProvider>
        <StatusBar style="auto" />
        <Root />
      </AppStoreProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  home: { padding: space.screen, gap: space.gap, paddingTop: 24 },
  intro: { marginTop: -4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
  tile: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
  },
  tileGlyph: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  surfacesCard: {
    backgroundColor: colors.card,
    borderRadius: space.radius,
    padding: space.cardPad,
    marginTop: 4,
  },
  spaced: { marginTop: 8 },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 36,
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  toastText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
