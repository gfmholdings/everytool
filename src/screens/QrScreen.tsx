import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { saveToPhotos, shareFile, tempFileUri } from '../lib/files';
import { describePayload, wifiPayload, contactPayload, type WifiSecurity } from '../lib/qrpayload';
import { useStore } from '../store/AppStore';
import { colors, type } from '../theme';

type Tab = 'make' | 'scan' | 'history';
type Kind = 'text' | 'wifi' | 'contact';

export function QrScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
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
  const qrRef = useRef<{ toDataURL: (cb: (b64: string) => void) => void } | null>(null);

  /** Render the shown QR to a PNG file (white margin, 1024 px). */
  const qrFile = (): Promise<string | null> =>
    new Promise((resolve) => {
      const svg = qrRef.current;
      if (!svg) return resolve(null);
      svg.toDataURL((b64) => {
        try {
          const uri = tempFileUri('png', 'qr');
          new File(uri).write(b64, { encoding: 'base64' });
          resolve(uri);
        } catch {
          resolve(null);
        }
      });
    });

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
      kind:
        kind === 'wifi'
          ? 'Wi-Fi network'
          : kind === 'contact'
            ? 'Contact'
            : describePayload(payload),
      payload,
    });
  };

  const onScan = (value: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScanned(value);
    setScanning(false);
    addQrHistory({ direction: 'scanned', kind: describePayload(value), payload: value });
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
    if (!asset) return;
    try {
      const results = await scanFromURLAsync(asset.uri, ['qr']);
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

  const openScanned = () => {
    if (!scanned) return;
    if (/^https?:\/\//i.test(scanned) || /^tel:|^mailto:/i.test(scanned)) {
      void Linking.openURL(scanned);
    } else {
      void Clipboard.setStringAsync(scanned).then(() => notify('Copied'));
    }
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
            <Field value={text} onChange={setText} placeholder="Text or a link" multiline />
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
              <QRCode
                value={made}
                size={220}
                quietZone={16}
                getRef={(c: { toDataURL: (cb: (b64: string) => void) => void } | null) => {
                  qrRef.current = c;
                }}
              />
              <Text style={[type.small, styles.center]} numberOfLines={2}>
                {made}
              </Text>
              <View style={styles.qrActions}>
                <View style={styles.half}>
                  <PrimaryButton
                    label="Share"
                    onPress={async () => {
                      const uri = await qrFile();
                      if (uri) await shareFile(uri, 'image/png');
                      else notify('Couldn’t render the QR code');
                    }}
                  />
                </View>
                <View style={styles.half}>
                  <GhostButton
                    label="Save to Photos"
                    onPress={async () => {
                      const uri = await qrFile();
                      if (!uri) return notify('Couldn’t render the QR code');
                      const problem = await saveToPhotos(uri);
                      notify(problem ?? 'Saved to Photos');
                    }}
                  />
                </View>
              </View>
              <GhostButton
                label="Copy text"
                onPress={() =>
                  void Clipboard.setStringAsync(made).then(() => notify('Copied'))
                }
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
          {scanned && (
            <Card style={styles.scanCard}>
              <Text style={type.label}>{describePayload(scanned)}</Text>
              <Text style={type.body}>{scanned}</Text>
              <PrimaryButton
                label={/^https?:|^tel:|^mailto:/i.test(scanned) ? 'Open' : 'Copy'}
                onPress={openScanned}
              />
            </Card>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {state.qrHistory.length === 0 ? (
            <Text style={type.small}>Nothing made or scanned yet.</Text>
          ) : (
            state.qrHistory.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  void Clipboard.setStringAsync(item.payload).then(() =>
                    notify('Copied'),
                  );
                }}
              >
                <Card style={styles.historyRow}>
                  <View style={styles.historyMain}>
                    <Text style={type.body} numberOfLines={1}>
                      {item.kind} · {item.direction}
                    </Text>
                    <Text style={type.small} numberOfLines={1}>
                      {item.payload}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Delete"
                    onPress={() => deleteQrHistory(item.id)}
                    style={styles.iconButton}
                  >
                    <Text style={styles.deleteGlyph}>✕</Text>
                  </Pressable>
                </Card>
              </Pressable>
            ))
          )}
          {state.qrHistory.length > 0 && (
            <GhostButton label="Clear history" onPress={clearQrHistory} />
          )}
        </>
      )}
    </ToolShell>
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
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyMain: { flex: 1, gap: 2 },
  iconButton: { padding: 6 },
  deleteGlyph: { fontSize: 16, color: colors.faint },
});
