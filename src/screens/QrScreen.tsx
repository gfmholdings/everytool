import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { saveToPhotos, shareFile, tempFileUri } from '../lib/files';
import { pngFileBase64 } from '../lib/shareSheet';
import { checkLink } from '../lib/linkCheck';
import {
  DEFAULT_QR_STYLE,
  formatQrDate,
  qrContentPreview,
  qrTypeLabel,
} from '../lib/qrHistory';
import {
  QR_AUTOSAVE_MS,
  autosaveDecision,
  displayedQr,
  emptyMaker,
  payloadFor,
  switchMakerKind,
  type MakerFields,
  type MakerKind,
  type MakerSecurity,
} from '../lib/qrMaker';
import { describePayload } from '../lib/qrpayload';
import { useStore } from '../store/AppStore';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';
import type { QrHistoryItem, QrStyle } from '../types';

type Notify = (msg: string, action?: { label: string; onPress: () => void }) => void;

type Tab = 'make' | 'scan' | 'history';

export function QrScreen({
  onBack,
  notify,
  initialImage,
}: {
  onBack: () => void;
  notify: Notify;
  /** An image shared into Everytool to scan for a QR code. */
  initialImage?: string;
}) {
  const { type, styles } = useThemed(makeStyles);
  const { state, addQrHistory, deleteQrHistory, restoreQrHistory, clearQrHistory } = useStore();
  const [tab, setTab] = useState<Tab>('make');
  const fieldsHist = useUndoHistory<MakerFields>(emptyMaker(), { shake: tab === 'make' });
  const fields = fieldsHist.present;
  const removed = useUndoHistory<QrHistoryItem | null>(null, { shake: tab === 'history' });
  const [openId, setOpenId] = useState<string | null>(null);
  const qrRef = useRef<{ toDataURL: (cb: (b64: string) => void) => void } | null>(null);
  const fieldsRef = useRef(fields);
  const lastSavedRef = useRef<string | null>(null);
  const addRef = useRef(addQrHistory);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    addRef.current = addQrHistory;
  }, [addQrHistory]);

  const writeHistory = (payload: string) => {
    addRef.current({
      direction: 'made',
      payload,
      style: DEFAULT_QR_STYLE,
    });
  };

  // Settled typing writes itself. The timer resets on every edit, so a
  // burst of keystrokes becomes one history row.
  useEffect(() => {
    if (tab !== 'make') return;
    const timer = setTimeout(() => {
      const decision = autosaveDecision({
        payload: payloadFor(fieldsRef.current),
        lastSaved: lastSavedRef.current,
        quietMs: QR_AUTOSAVE_MS,
        leaving: false,
      });
      if (decision.save) {
        addRef.current({
          direction: 'made',
          payload: decision.save,
          style: DEFAULT_QR_STYLE,
        });
      }
      lastSavedRef.current = decision.lastSaved;
    }, QR_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [fields, tab]);

  // Back leaves the tool and unmounts this screen. Commit whatever is
  // still waiting, then the next visit starts from emptyMaker().
  useEffect(() => {
    return () => {
      const decision = autosaveDecision({
        payload: payloadFor(fieldsRef.current),
        lastSaved: lastSavedRef.current,
        quietMs: 0,
        leaving: true,
      });
      if (decision.save) {
        addRef.current({
          direction: 'made',
          payload: decision.save,
          style: DEFAULT_QR_STYLE,
        });
      }
    };
  }, []);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scannedRef = useRef(false);
  const [scanned, setScanned] = useState<string | null>(null);

  const preview = displayedQr(fields);

  const commitNow = () => {
    const decision = autosaveDecision({
      payload: payloadFor(fields),
      lastSaved: lastSavedRef.current,
      quietMs: 0,
      leaving: true,
    });
    if (decision.save) writeHistory(decision.save);
    lastSavedRef.current = decision.lastSaved;
  };

  const onTab = (next: Tab) => {
    if (tab === 'make' && next !== 'make') commitNow();
    setTab(next);
  };

  const onKind = (next: MakerKind) => {
    if (next === fields.kind) return;
    commitNow();
    lastSavedRef.current = null;
    fieldsHist.commit(switchMakerKind(fields, next));
  };

  const make = () => {
    if (!preview) return;
    commitNow();
  };

  const onScan = (value: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScanned(value);
    setScanning(false);
    addQrHistory({ direction: 'scanned', kind: describePayload(value), payload: value });
  };

  const scanImage = async (uri: string) => {
    try {
      const results = await scanFromURLAsync(uri, ['qr']);
      const first = results[0];
      if (first?.data) {
        scannedRef.current = false;
        onScan(first.data);
      } else {
        notify('No QR code found in that photo');
      }
    } catch {
      notify('That photo couldn’t be scanned');
    }
  };

  const scanFromPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset) await scanImage(asset.uri);
  };

  // A screenshot or photo shared into Everytool → scan it straight away.
  const scannedShared = useRef<string | null>(null);
  useEffect(() => {
    if (!initialImage || scannedShared.current === initialImage) return;
    scannedShared.current = initialImage;
    const t = setTimeout(() => {
      const decision = autosaveDecision({
        payload: payloadFor(fieldsRef.current),
        lastSaved: lastSavedRef.current,
        quietMs: 0,
        leaving: true,
      });
      if (decision.save) {
        addRef.current({
          direction: 'made',
          payload: decision.save,
          style: DEFAULT_QR_STYLE,
        });
      }
      lastSavedRef.current = decision.lastSaved;
      setTab('scan');
      void scanImage(initialImage);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImage]);

  const scannedCheck = scanned ? checkLink(scanned) : null;
  const openable = scannedCheck != null && scannedCheck.kind !== 'other';

  const openScanned = () => {
    if (!scanned) return;
    if (openable) void Linking.openURL(scanned);
    else void Clipboard.setStringAsync(scanned).then(() => notify('Copied'));
  };

  const undoDelete = () => {
    const item = removed.present;
    if (!item) return;
    removed.undo();
    restoreQrHistory(item);
  };
  const redoDelete = () => {
    const item = removed.redo();
    if (!item) return;
    deleteQrHistory(item.id);
  };

  return (
    <ToolShell
      title="QR toolbox"
      onBack={onBack}
      undo={
        tab === 'history'
          ? {
              canUndo: removed.canUndo,
              canRedo: removed.canRedo,
              onUndo: undoDelete,
              onRedo: redoDelete,
            }
          : tab === 'make'
            ? {
                canUndo: fieldsHist.canUndo,
                canRedo: fieldsHist.canRedo,
                onUndo: () => fieldsHist.undo(),
                onRedo: () => fieldsHist.redo(),
              }
            : undefined
      }
    >
      <Segmented
        options={[
          { id: 'make', label: 'Make' },
          { id: 'scan', label: 'Scan' },
          { id: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={onTab}
      />

      {tab === 'make' && (
        <>
          <Segmented
            options={[
              { id: 'text', label: 'Text / link' },
              { id: 'wifi', label: 'Wi-Fi' },
              { id: 'contact', label: 'Contact' },
            ]}
            value={fields.kind}
            onChange={onKind}
          />
          {fields.kind === 'text' && (
            <Field
              value={fields.text}
              onChange={(text) => fieldsHist.commit((prev) => ({ ...prev, text }), true)}
              placeholder="Text or a link"
              multiline
              testID="qr.text"
            />
          )}
          {fields.kind === 'wifi' && (
            <>
              <Field
                value={fields.ssid}
                onChange={(ssid) => fieldsHist.commit((prev) => ({ ...prev, ssid }), true)}
                placeholder="Network name"
              />
              <Field
                value={fields.password}
                onChange={(password) => fieldsHist.commit((prev) => ({ ...prev, password }), true)}
                placeholder="Password"
                secure
              />
              <Segmented
                options={[
                  { id: 'WPA' as MakerSecurity, label: 'WPA' },
                  { id: 'WEP' as MakerSecurity, label: 'WEP' },
                  { id: 'nopass' as MakerSecurity, label: 'Open' },
                ]}
                value={fields.security}
                onChange={(security) => fieldsHist.commit((prev) => ({ ...prev, security }))}
              />
            </>
          )}
          {fields.kind === 'contact' && (
            <>
              <Field
                value={fields.name}
                onChange={(name) => fieldsHist.commit((prev) => ({ ...prev, name }), true)}
                placeholder="Name"
              />
              <Field
                value={fields.phone}
                onChange={(phone) => fieldsHist.commit((prev) => ({ ...prev, phone }), true)}
                placeholder="Phone (optional)"
                keyboard="phone-pad"
              />
              <Field
                value={fields.email}
                onChange={(email) => fieldsHist.commit((prev) => ({ ...prev, email }), true)}
                placeholder="Email (optional)"
                keyboard="email-address"
              />
            </>
          )}
          <PrimaryButton label="Make QR code" onPress={make} disabled={!preview} />
          {preview && (
            <Card style={styles.qrCard}>
              <QrMark
                value={preview}
                qrStyle={DEFAULT_QR_STYLE}
                size={220}
                quietZone={16}
                qrRef={qrRef}
              />
              <Text style={[type.small, styles.center]} numberOfLines={2}>
                {preview}
              </Text>
              <QrFileActions
                notify={notify}
                copyLabel="Copy text"
                subject={qrContentPreview(preview)}
                onCopy={() => void Clipboard.setStringAsync(preview).then(() => notify('Copied'))}
                file={() => qrFileFrom(qrRef.current)}
              />
            </Card>
          )}
        </>
      )}

      {tab === 'scan' && (
        <>
          {scanning ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => onScan(data)}
              />
              <GhostButton
                label="Stop"
                onPress={() => {
                  setScanning(false);
                  scannedRef.current = false;
                }}
              />
            </View>
          ) : (
            <>
              <PrimaryButton
                label="Scan with camera"
                onPress={async () => {
                  if (!permission?.granted) {
                    const p = await requestPermission();
                    if (!p.granted) return;
                  }
                  scannedRef.current = false;
                  setScanned(null);
                  setScanning(true);
                }}
              />
              <GhostButton label="Scan from a photo" onPress={scanFromPhoto} />
            </>
          )}
          {scanned && scannedCheck && (
            <Card style={styles.scanCard}>
              <Text style={type.label}>{describePayload(scanned)}</Text>
              {scannedCheck.kind === 'url' && (
                <>
                  <Text style={type.small}>Goes to</Text>
                  <Text style={styles.host} selectable>
                    {scannedCheck.host ?? '—'}
                  </Text>
                </>
              )}
              <Text style={type.body} selectable>
                {scanned}
              </Text>
              {scannedCheck.warnings.length > 0 ? (
                <View style={styles.warnBox}>
                  <Text style={styles.warnTitle}>Check before you open</Text>
                  {scannedCheck.warnings.map((w) => (
                    <Text key={w} style={styles.warnLine}>
                      • {w}
                    </Text>
                  ))}
                </View>
              ) : (
                scannedCheck.kind === 'url' && (
                  <Text style={styles.okLine}>No common tricks found in this link.</Text>
                )
              )}
              <PrimaryButton
                label={openable ? (scannedCheck.risky ? 'Open anyway' : 'Open') : 'Copy'}
                onPress={openScanned}
              />
              {openable && (
                <GhostButton
                  label="Copy"
                  onPress={() =>
                    void Clipboard.setStringAsync(scanned).then(() => notify('Copied'))
                  }
                />
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'history' && (
        <QrHistoryList
          items={[...state.qrHistory].sort((a, b) => b.createdAt - a.createdAt)}
          openId={openId}
          qrRef={qrRef}
          notify={notify}
          onOpen={setOpenId}
          onDelete={(id) => {
            const item = state.qrHistory.find((row) => row.id === id);
            if (!item) return;
            removed.commit(item);
            deleteQrHistory(id);
            if (openId === id) setOpenId(null);
            notify('Removed', {
              label: 'Undo',
              onPress: () => {
                restoreQrHistory(item);
                removed.undo();
              },
            });
          }}
          onClear={() => {
            Alert.alert(
              'Clear all QR codes?',
              'This removes every saved code from this phone. It can’t be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear all',
                  style: 'destructive',
                  onPress: () => {
                    clearQrHistory();
                    setOpenId(null);
                    notify('Cleared');
                  },
                },
              ],
            );
          }}
        />
      )}
    </ToolShell>
  );
}

function QrHistoryList({
  items,
  openId,
  qrRef,
  notify,
  onOpen,
  onDelete,
  onClear,
}: {
  items: QrHistoryItem[];
  openId: string | null;
  qrRef: { current: { toDataURL: (cb: (b64: string) => void) => void } | null };
  notify: Notify;
  onOpen: (id: string | null) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const open = items.find((item) => item.id === openId) ?? null;
  if (open) {
    return (
      <Card style={styles.qrCard}>
        <Text style={type.body}>
          {qrTypeLabel(open.type)} · {open.direction}
        </Text>
        <QrMark value={open.payload} qrStyle={open.style} size={220} quietZone={16} qrRef={qrRef} />
        <Text style={[type.body, styles.center]} selectable>
          {qrContentPreview(open.payload)}
        </Text>
        <Text style={type.small}>{formatQrDate(open.createdAt)}</Text>
        <QrFileActions
          notify={notify}
          copyLabel="Copy"
          subject={qrContentPreview(open.payload)}
          onCopy={() => void Clipboard.setStringAsync(open.payload).then(() => notify('Copied'))}
          file={() => qrFileFrom(qrRef.current)}
        />
        <GhostButton label="Back to history" onPress={() => onOpen(null)} />
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card style={styles.empty}>
        <Text style={type.h2}>No QR codes yet</Text>
        <Text style={type.small}>
          Codes you make are kept on this phone, newest first. Nothing leaves the device.
        </Text>
      </Card>
    );
  }
  return (
    <>
      {items.map((item) => (
        <SwipeRow key={item.id} onDelete={() => onDelete(item.id)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${qrTypeLabel(item.type)}, ${item.direction}, ${qrContentPreview(item.payload)}`}
            accessibilityHint="Opens the QR code"
            onPress={() => onOpen(item.id)}
          >
            <Card style={styles.historyRow}>
              <View style={styles.thumb}>
                <QrMark value={item.payload} qrStyle={item.style} size={48} quietZone={2} />
              </View>
              <View style={styles.historyMain}>
                <Text style={type.body} numberOfLines={1}>
                  {qrTypeLabel(item.type)} · {item.direction}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {qrContentPreview(item.payload)}
                </Text>
                <Text style={type.small}>{formatQrDate(item.createdAt)}</Text>
              </View>
            </Card>
          </Pressable>
        </SwipeRow>
      ))}
      <GhostButton label="Clear all" onPress={onClear} />
    </>
  );
}

function QrMark({
  value,
  qrStyle,
  size,
  quietZone,
  qrRef,
}: {
  value: string;
  qrStyle: QrStyle;
  size: number;
  quietZone: number;
  qrRef?: { current: { toDataURL: (cb: (b64: string) => void) => void } | null };
}) {
  return (
    <QRCode
      value={value}
      size={size}
      quietZone={quietZone}
      color={qrStyle.foreground}
      backgroundColor={qrStyle.background}
      getRef={
        qrRef
          ? (c: { toDataURL: (cb: (b64: string) => void) => void } | null) => {
              qrRef.current = c;
            }
          : undefined
      }
    />
  );
}

function QrFileActions({
  notify,
  copyLabel,
  subject,
  onCopy,
  file,
}: {
  notify: Notify;
  copyLabel: string;
  /** Mail subject only. The sheet item is the PNG file. */
  subject?: string;
  onCopy: () => void;
  file: () => Promise<string | null>;
}) {
  const { styles } = useThemed(makeStyles);
  return (
    <>
      <View style={styles.qrActions}>
        <View style={styles.half}>
          <PrimaryButton
            label="Share"
            onPress={async () => {
              const uri = await file();
              if (!uri) return notify('Couldn’t render the QR code');
              const ok = await shareFile(uri, 'image/png', { subject });
              if (!ok) notify('Sharing isn’t available here.');
            }}
          />
        </View>
        <View style={styles.half}>
          <GhostButton
            label="Save to Photos"
            onPress={async () => {
              const uri = await file();
              if (!uri) return notify('Couldn’t render the QR code');
              const problem = await saveToPhotos(uri);
              notify(problem ?? 'Saved to Photos');
            }}
          />
        </View>
      </View>
      <GhostButton label={copyLabel} onPress={onCopy} />
    </>
  );
}

function qrFileFrom(
  svg: { toDataURL: (cb: (b64: string) => void) => void } | null,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!svg) return resolve(null);
    svg.toDataURL((b64) => {
      try {
        const uri = tempFileUri('png', 'qr');
        new File(uri).write(pngFileBase64(b64), { encoding: 'base64' });
        resolve(uri);
      } catch {
        resolve(null);
      }
    });
  });
}

function SwipeRow({ children, onDelete }: { children: ReactNode; onDelete: () => void }) {
  const { styles } = useThemed(makeStyles);
  const [{ x, pan }] = useState(() => {
    const translate = new Animated.Value(0);
    const responder = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) + 6,
      onPanResponderMove: (_, g) => {
        translate.setValue(Math.min(0, Math.max(g.dx, -160)));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -120 || g.vx < -0.8) {
          onDelete();
          return;
        }
        Animated.spring(translate, {
          toValue: g.dx < -48 ? -88 : 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    });
    return { x: translate, pan: responder };
  });

  return (
    <View style={styles.swipeWrap}>
      <Pressable accessibilityLabel="Delete" onPress={onDelete} style={styles.swipeDelete}>
        <Text style={styles.swipeDeleteLabel}>Delete</Text>
      </Pressable>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    qrCard: { alignItems: 'center', gap: 12, paddingVertical: 24 },
    qrActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', alignItems: 'center' },
    half: { flex: 1 },
    center: { textAlign: 'center' },
    cameraWrap: { gap: 8 },
    camera: { width: '100%', height: 340, borderRadius: 16, overflow: 'hidden' },
    scanCard: { gap: 10 },
    host: { fontSize: 22, fontWeight: '800', color: p.textPrimary },
    warnBox: { backgroundColor: p.secondary, borderRadius: 12, padding: 12, gap: 4 },
    warnTitle: { fontSize: 15, fontWeight: '700', color: p.warning },
    warnLine: { fontSize: 14, color: p.textPrimary },
    okLine: { fontSize: 14, color: p.success },
    empty: { gap: 6 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    historyMain: { flex: 1, gap: 2 },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: 8,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.surface,
    },
    swipeWrap: { borderRadius: 18, overflow: 'hidden' },
    swipeDelete: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: 88,
      backgroundColor: p.destructive,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swipeDeleteLabel: { color: p.onDestructive, fontSize: 15, fontWeight: '700' },
  });
}
