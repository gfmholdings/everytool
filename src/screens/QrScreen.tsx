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
import { saveToPhotos, shareFile, tempFileUri } from '../lib/files';
import { pngFileBase64 } from '../lib/shareSheet';
import { checkLink } from '../lib/linkCheck';
import {
  DEFAULT_QR_STYLE,
  formatQrDate,
  qrContentPreview,
  qrTypeLabel,
} from '../lib/qrHistory';
import { describePayload, wifiPayload, contactPayload, type WifiSecurity } from '../lib/qrpayload';
import { useStore } from '../store/AppStore';
import { colors, type } from '../theme';
import type { QrHistoryItem, QrStyle } from '../types';

type Tab = 'make' | 'scan' | 'history';
type Kind = 'text' | 'wifi' | 'contact';

export function QrScreen({
  onBack,
  notify,
  initialImage,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
  /** An image shared into Everytool to scan for a QR code. */
  initialImage?: string;
}) {
  const { state, addQrHistory, deleteQrHistory, clearQrHistory } = useStore();
  const [tab, setTab] = useState<Tab>('make');
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [security, setSecurity] = useState<WifiSecurity>('WPA');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const qrRef = useRef<{ toDataURL: (cb: (b64: string) => void) => void } | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scannedRef = useRef(false);
  const [scanned, setScanned] = useState<string | null>(null);

  const buildPayload = (): string | null => {
    if (kind === 'text') return text.trim() ? text : null;
    if (kind === 'wifi') return ssid.trim() ? wifiPayload(ssid, password, security) : null;
    return name.trim()
      ? contactPayload({ name, phone: phone || undefined, email: email || undefined })
      : null;
  };

  const make = () => {
    const payload = buildPayload();
    if (!payload) return;
    setMade(payload);
    addQrHistory({
      direction: 'made',
      payload,
      style: DEFAULT_QR_STYLE,
    });
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

  return (
    <ToolShell title="QR toolbox" onBack={onBack}>
      <Segmented
        options={[
          { id: 'make', label: 'Make' },
          { id: 'scan', label: 'Scan' },
          { id: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'make' && (
        <>
          <Segmented
            options={[
              { id: 'text', label: 'Text / link' },
              { id: 'wifi', label: 'Wi-Fi' },
              { id: 'contact', label: 'Contact' },
            ]}
            value={kind}
            onChange={setKind}
          />
          {kind === 'text' && (
            <Field value={text} onChange={setText} placeholder="Text or a link" multiline testID="qr.text" />
          )}
          {kind === 'wifi' && (
            <>
              <Field value={ssid} onChange={setSsid} placeholder="Network name" />
              <Field value={password} onChange={setPassword} placeholder="Password" secure />
              <Segmented
                options={[
                  { id: 'WPA' as WifiSecurity, label: 'WPA' },
                  { id: 'WEP' as WifiSecurity, label: 'WEP' },
                  { id: 'nopass' as WifiSecurity, label: 'Open' },
                ]}
                value={security}
                onChange={setSecurity}
              />
            </>
          )}
          {kind === 'contact' && (
            <>
              <Field value={name} onChange={setName} placeholder="Name" />
              <Field value={phone} onChange={setPhone} placeholder="Phone (optional)" keyboard="phone-pad" />
              <Field value={email} onChange={setEmail} placeholder="Email (optional)" keyboard="email-address" />
            </>
          )}
          <PrimaryButton label="Make QR code" onPress={make} disabled={!buildPayload()} />
          {made && (
            <Card style={styles.qrCard}>
              <QrMark
                value={made}
                qrStyle={DEFAULT_QR_STYLE}
                size={220}
                quietZone={16}
                qrRef={qrRef}
              />
              <Text style={[type.small, styles.center]} numberOfLines={2}>
                {made}
              </Text>
              <QrFileActions
                notify={notify}
                copyLabel="Copy text"
                subject={qrContentPreview(made)}
                onCopy={() => void Clipboard.setStringAsync(made).then(() => notify('Copied'))}
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
                orange={scannedCheck.risky}
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
            deleteQrHistory(id);
            if (openId === id) setOpenId(null);
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
  notify: (msg: string) => void;
  onOpen: (id: string | null) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
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
  notify: (msg: string) => void;
  copyLabel: string;
  /** Mail subject only. The sheet item is the PNG file. */
  subject?: string;
  onCopy: () => void;
  file: () => Promise<string | null>;
}) {
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

const styles = StyleSheet.create({
  qrCard: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  qrActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', alignItems: 'center' },
  half: { flex: 1 },
  center: { textAlign: 'center' },
  cameraWrap: { gap: 8 },
  camera: { width: '100%', height: 340, borderRadius: 16, overflow: 'hidden' },
  scanCard: { gap: 10 },
  host: { fontSize: 22, fontWeight: '800', color: colors.ink },
  warnBox: { backgroundColor: '#FFF4E5', borderRadius: 12, padding: 12, gap: 4 },
  warnTitle: { fontSize: 15, fontWeight: '700', color: '#9A4D00' },
  warnLine: { fontSize: 14, color: '#7A3E00' },
  okLine: { fontSize: 14, color: colors.good },
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
    backgroundColor: '#FFFFFF',
  },
  swipeWrap: { borderRadius: 18, overflow: 'hidden' },
  swipeDelete: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 88,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
