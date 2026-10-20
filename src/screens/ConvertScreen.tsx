import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, measureImage, saveToPhotos, shareFile, tempFileUri } from '../lib/files';
import { mergePdfSources, pdfSourceFromUri, type PdfSource } from '../lib/pdf';
import { imageHasLocation, stripLocation } from '../store/sharedVault';
import { colors, type } from '../theme';

/** jpg/png re-encode; pdf combines; "clean" keeps the photo as-is minus location. */
type Format = 'jpg' | 'png' | 'pdf' | 'clean';

interface Source {
  uri: string;
  name?: string;
  width: number;
  height: number;
}

interface Output {
  uri: string;
  filename: string;
  bytes: number;
  mime: string;
  /** null = couldn't check here */
  hasLocation: boolean | null;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

function extOf(uri: string): string {
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(uri);
  return (m?.[1] ?? 'jpg').toLowerCase();
}

function baseName(s: Source, i: number): string {
  return (s.name ?? `photo-${i + 1}`).replace(/\.[a-z0-9]+$/i, '');
}

/**
 * Convert: photos → JPG / PNG (one file each, any number at once), → one
 * PDF, or "Remove location": the same photo without its GPS data (no
 * re-encode, no quality loss). JPG/PNG re-encodes also carry no location
 * or camera metadata. All on-device.
 */
export function ConvertScreen({
  onBack,
  initialSource,
  notify,
}: {
  onBack: () => void;
  initialSource?: Source;
  notify: (msg: string) => void;
}) {
  const [sources, setSources] = useState<Source[]>(initialSource ? [initialSource] : []);
  const [format, setFormat] = useState<Format>('jpg');
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Files from the share sheet arrive without a size; measure them.
  useEffect(() => {
    const unknown = sources.filter((x) => x.width <= 0 || x.height <= 0);
    if (unknown.length === 0) return;
    let live = true;
    void Promise.all(
      sources.map(async (x) =>
        x.width > 0 && x.height > 0 ? x : { ...x, ...(await measureImage(x.uri)) },
      ),
    ).then((measured) => {
      if (live) setSources(measured);
    });
    return () => {
      live = false;
    };
  }, [sources]);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is off. Turn it on in Settings to pick photos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: 50,
      quality: 1,
      // keep the original file so "Remove location" has something to remove
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled) return;
    setSources(
      res.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `photo-${i + 1}`,
        width: a.width,
        height: a.height,
      })),
    );
    setOutputs([]);
    setError(null);
  };

  const convert = async () => {
    if (sources.length === 0) return;
    setBusy(true);
    setError(null);
    setOutputs([]);
    try {
      if (format === 'pdf') {
        const pdfSources: PdfSource[] = [];
        for (const [i, s] of sources.entries()) {
          setProgress(`Preparing page ${i + 1} of ${sources.length}`);
          const jpg = await manipulateAsync(s.uri, [], { format: SaveFormat.JPEG, compress: 0.92 });
          pdfSources.push(await pdfSourceFromUri(jpg.uri, baseName(s, i), 'image'));
        }
        const out = await mergePdfSources(pdfSources);
        setOutputs([
          { uri: out.uri, filename: 'photos.pdf', bytes: out.bytes, mime: MIME.pdf!, hasLocation: false },
        ]);
      } else {
        const made: Output[] = [];
        for (const [i, s] of sources.entries()) {
          setProgress(`${i + 1} of ${sources.length}`);
          if (format === 'clean') {
            const ext = extOf(s.uri);
            const target = tempFileUri(ext, baseName(s, i));
            if (!stripLocation(s.uri, target)) {
              throw new Error('Removing location needs the installed Everytool app.');
            }
            const f = new File(target);
            made.push({
              uri: target,
              filename: `${baseName(s, i)}.${ext}`,
              bytes: f.size ?? 0,
              mime: MIME[ext] ?? 'image/jpeg',
              hasLocation: imageHasLocation(target),
            });
          } else {
            const out = await manipulateAsync(s.uri, [], {
              format: format === 'jpg' ? SaveFormat.JPEG : SaveFormat.PNG,
              compress: format === 'jpg' ? 0.92 : 1,
            });
            const target = tempFileUri(format, baseName(s, i));
            await new File(out.uri).copy(new File(target));
            made.push({
              uri: target,
              filename: `${baseName(s, i)}.${format}`,
              bytes: new File(target).size ?? 0,
              mime: MIME[format]!,
              hasLocation: imageHasLocation(target),
            });
          }
        }
        setOutputs(made);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const saveAll = async () => {
    let saved = 0;
    for (const o of outputs) {
      const problem = await saveToPhotos(o.uri);
      if (problem) {
        setError(problem);
        break;
      }
      saved += 1;
    }
    if (saved > 0) notify(saved === 1 ? 'Saved to Photos' : `Saved ${saved} to Photos`);
  };

  const first = sources[0];
  const totalBytes = outputs.reduce((n, o) => n + o.bytes, 0);
  const noLocation = outputs.length > 0 && outputs.every((o) => o.hasLocation === false);
  const label =
    format === 'pdf'
      ? 'Make one PDF'
      : format === 'clean'
        ? `Remove location${sources.length > 1 ? ` from ${sources.length}` : ''}`
        : `Convert ${sources.length > 1 ? `${sources.length} photos ` : ''}to ${format.toUpperCase()}`;

  return (
    <ToolShell title="Convert" onBack={onBack}>
      {first ? (
        <Card style={styles.previewCard}>
          <Image source={{ uri: first.uri }} style={styles.preview} />
          <Text style={type.small}>
            {sources.length === 1 ? `${first.width} × ${first.height}` : `${sources.length} photos`}
          </Text>
        </Card>
      ) : null}
      <PrimaryButton label={first ? 'Pick different photos' : 'Pick photos'} onPress={pick} />
      {first && (
        <Segmented
          options={[
            { id: 'jpg', label: 'JPG' },
            { id: 'png', label: 'PNG' },
            { id: 'pdf', label: 'PDF' },
            { id: 'clean', label: 'No location' },
          ]}
          value={format}
          onChange={(f) => {
            setFormat(f);
            setOutputs([]);
          }}
        />
      )}
      {first && format === 'clean' && (
        <Text style={type.small}>
          Keeps the photo exactly as it is — same format, same quality — minus
          where it was taken.
        </Text>
      )}
      {first && (
        <PrimaryButton
          label={busy ? 'Working…' : label}
          onPress={() => void convert()}
          disabled={busy}
          orange
          testID="convert.run"
        />
      )}
      {!!progress && <Text style={[type.small, styles.center]}>{progress}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {outputs.length > 0 && (
        <Card style={styles.resultCard}>
          <Text style={type.label}>Done</Text>
          <Text style={type.numSmall}>
            {outputs.length === 1
              ? `${outputs[0]!.filename} · ${formatBytes(outputs[0]!.bytes)}`
              : `${outputs.length} files · ${formatBytes(totalBytes)}`}
          </Text>
          {noLocation && <Text style={styles.ok}>No location data in the result.</Text>}
          {outputs.length === 1 ? (
            <PrimaryButton
              label="Share file"
              onPress={() => void shareFile(outputs[0]!.uri, outputs[0]!.mime)}
            />
          ) : (
            outputs.map((o) => (
              <View key={o.uri} style={styles.fileRow}>
                <Text style={[type.body, styles.flex]} numberOfLines={1}>
                  {o.filename}
                </Text>
                <GhostButton label="Share" onPress={() => void shareFile(o.uri, o.mime)} />
              </View>
            ))
          )}
          {format !== 'pdf' && (
            <GhostButton
              label={outputs.length > 1 ? `Save all ${outputs.length} to Photos` : 'Save to Photos'}
              onPress={() => void saveAll()}
            />
          )}
        </Card>
      )}
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  previewCard: { alignItems: 'center', gap: 8 },
  preview: { width: '100%', height: 220, borderRadius: 10, backgroundColor: colors.border },
  resultCard: { gap: 10 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  ok: { color: colors.good, fontSize: 14 },
  error: { color: colors.danger, fontSize: 15 },
});
